import os
import json
from datetime import timedelta
from django.utils import timezone
import redis.asyncio as aioredis
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import AuctionItem, Bid

# Shared connection pool for high concurrency
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
REDIS_POOL = aioredis.ConnectionPool.from_url(
    REDIS_URL,
    max_connections=100,
    socket_timeout=30,
    health_check_interval=30,
    retry_on_timeout=True,
)

def get_minimum_step(current_price):
    price = float(current_price)
    if price < 1000:
        return 50.0
    elif price < 10000:
        return 100.0
    elif price < 100000:
        return 500.0
    elif price < 1000000:
        return 5000.0
    elif price < 10000000:
        return 25000.0
    else:
        # 1 Crore / 10M+: minimum step is 100,000 (1 Lakh)
        return 100000.0

@database_sync_to_async
def get_auction_info(item_id):
    try:
        item = AuctionItem.objects.select_related('seller', 'winner').get(pk=item_id)
        now = timezone.now()
        is_live = bool(item.is_active and item.end_time > now)
        current = float(item.current_bid) if item.current_bid is not None else float(item.start_price)
        highest_bid_obj = Bid.objects.filter(item=item).order_by('-amount').first()
        highest_bidder = highest_bid_obj.user.username if highest_bid_obj else None
        return {
            'is_active': item.is_active,
            'is_live': is_live,
            'end_time': item.end_time.isoformat(),
            'end_time_dt': item.end_time,
            'current_bid': current,
            'start_price': float(item.start_price),
            'highest_bidder': highest_bidder,
            'seller': item.seller.username if item.seller else None,
            'winner': item.winner.username if item.winner else (highest_bidder if not is_live else None)
        }
    except AuctionItem.DoesNotExist:
        return None

@database_sync_to_async
def finalize_expired_auction(item_id):
    try:
        item = AuctionItem.objects.get(pk=item_id)
        if item.is_active:
            highest_bid_obj = Bid.objects.filter(item=item).order_by('-amount').first()
            if highest_bid_obj:
                item.winner = highest_bid_obj.user
                item.current_bid = highest_bid_obj.amount
            item.is_active = False
            item.save(update_fields=['is_active', 'winner', 'current_bid'])
            return {
                'winner': item.winner.username if item.winner else None,
                'winning_bid': float(item.current_bid) if item.current_bid else float(item.start_price)
            }
    except Exception as e:
        print(f"Error finalizing expired auction {item_id}: {e}")
    return None

@database_sync_to_async
def check_and_extend_auction(item_id):
    """Anti-Sniping (Soft Close): If less than 60 seconds remain, extend by 60s."""
    try:
        item = AuctionItem.objects.get(pk=item_id)
        now = timezone.now()
        remaining = (item.end_time - now).total_seconds()
        if 0 < remaining < 60:
            item.end_time = now + timedelta(seconds=60)
            item.save(update_fields=['end_time'])
            return item.end_time.isoformat()
    except Exception as e:
        print(f"Error extending auction {item_id}: {e}")
    return None

@database_sync_to_async
def record_bid(user, item_id, amount):
    try:
        item = AuctionItem.objects.get(pk=item_id)
        new_bid = Bid.objects.create(user=user, item=item, amount=amount)
        item.current_bid = amount
        item.save(update_fields=['current_bid'])
        return new_bid, None
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'message_dict'):
            err_msg = '; '.join([', '.join(v) for v in e.message_dict.values()])
        elif hasattr(e, 'messages'):
            err_msg = '; '.join(e.messages)
        print(f"Error recording bid for item {item_id}: {err_msg}")
        return None, err_msg

class AuctionConsumer(AsyncWebsocketConsumer):
    LUA_ATOMIC_BID = """
    local current_bidder = redis.call('GET', KEYS[2])
    local user = ARGV[2]

    if current_bidder and current_bidder == user then
        return -1
    end

    local current = redis.call('GET', KEYS[1])
    local new_val = tonumber(ARGV[1])

    if not current then
        redis.call('SET', KEYS[1], ARGV[1])
        redis.call('SET', KEYS[2], user)
        return 1
    end

    if new_val > tonumber(current) then
        redis.call('SET', KEYS[1], ARGV[1])
        redis.call('SET', KEYS[2], user)
        return 1
    else
        return 0
    end
    """

    async def connect(self):
        try:
            self.item_id = self.scope['url_route']['kwargs']['item_id']
            self.group_name = f'auction_{self.item_id}'
            self.redis_bid_key = f'auction:{self.item_id}:highest_bid'
            self.redis_bidder_key = f'auction:{self.item_id}:highest_bidder'
            self.redis = aioredis.Redis(connection_pool=REDIS_POOL)

            # Verify item exists
            item_info = await get_auction_info(self.item_id)
            if item_info is None:
                await self.close()
                return

            if item_info['is_active']:
                try:
                    # Sync Redis cache with DB state if needed
                    cached_bid = await self.redis.get(self.redis_bid_key)
                    if cached_bid is None or float(cached_bid) < float(item_info['current_bid']):
                        await self.redis.set(self.redis_bid_key, str(item_info['current_bid']))

                    cached_bidder = await self.redis.get(self.redis_bidder_key)
                    if item_info.get('highest_bidder'):
                        if cached_bidder is None or cached_bid is None or float(cached_bid) < float(item_info['current_bid']):
                            await self.redis.set(self.redis_bidder_key, item_info['highest_bidder'])
                except Exception as cache_err:
                    print(f"Warning: Redis cache sync skipped: {cache_err}")

            await self.channel_layer.group_add(
                self.group_name,
                self.channel_name
            )
            await self.accept()

            # If already finalized, push ended state
            if not item_info['is_live']:
                await self.send(text_data=json.dumps({
                    'type': 'auction_ended',
                    'item_id': self.item_id,
                    'winner': item_info.get('winner'),
                    'winning_bid': item_info.get('current_bid'),
                }))
        except Exception as e:
            print(f"Error in consumer connect: {e}")
            await self.close()

    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name
            )
        except Exception as e:
            print(f"Error in consumer disconnect: {e}")

    async def receive(self, text_data):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Authentication required to place a bid. Please log in.'
            }))
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Invalid JSON format.'
            }))
            return

        if data.get('type') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))
            return

        if data.get('type') == 'bid':
            try:
                amount = float(data.get('amount', 0))
            except (ValueError, TypeError):
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Invalid bid amount.'
                }))
                return

            try:
                item_info = await get_auction_info(self.item_id)
                if not item_info:
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': 'Auction item not found.'
                    }))
                    return

                # Check if user is seller (Shill bidding prevention)
                if item_info.get('seller') and user.username == item_info.get('seller'):
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': 'You are the seller of this auction and cannot bid on your own listing.'
                    }))
                    return

                # Check if auction has expired
                now = timezone.now()
                if not item_info.get('is_live') or item_info.get('end_time_dt') <= now:
                    fin = await finalize_expired_auction(self.item_id)
                    await self.channel_layer.group_send(
                        self.group_name,
                        {
                            'type': 'auction_ended',
                            'item_id': self.item_id,
                            'winner': fin.get('winner') if fin else item_info.get('highest_bidder'),
                            'winning_bid': fin.get('winning_bid') if fin else item_info.get('current_bid'),
                        }
                    )
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': 'This auction has already ended.'
                    }))
                    return

                # Check proportional minimum step requirement
                current_highest = float(item_info['current_bid'])
                min_step = get_minimum_step(current_highest)
                if amount < current_highest + min_step:
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': f'Minimum increment is ₹{min_step:,.0f}. Bid must be at least ₹{current_highest + min_step:,.0f}.'
                    }))
                    return

                # Atomically evaluate bid against Redis in-memory highest bid and leader
                result = await self.redis.eval(
                    self.LUA_ATOMIC_BID,
                    2,
                    self.redis_bid_key,
                    self.redis_bidder_key,
                    str(amount),
                    user.username
                )

                if result == -1:
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': 'You are currently the highest bidder. You cannot outbid yourself!'
                    }))
                    return
                elif result == 1:
                    # Save approved bid to PostgreSQL safely
                    new_bid, db_err = await record_bid(user, self.item_id, amount)
                    if db_err:
                        await self.send(text_data=json.dumps({
                            'type': 'error',
                            'message': db_err
                        }))
                        return

                    # Anti-Sniping (Soft Close check)
                    new_end_time = await check_and_extend_auction(self.item_id)
                    extended = bool(new_end_time)

                    # Broadcast live update to all connected clients in the room
                    await self.channel_layer.group_send(
                        self.group_name,
                        {
                            'type': 'bid_update',
                            'user': user.username,
                            'item_id': self.item_id,
                            'amount': str(amount),
                            'highest_bidder': user.username,
                            'end_time': new_end_time if extended else item_info['end_time'],
                            'extended': extended
                        }
                    )
                else:
                    current_val = await self.redis.get(self.redis_bid_key)
                    if isinstance(current_val, bytes):
                        current_val = current_val.decode('utf-8')
                    await self.send(text_data=json.dumps({
                        'type': 'error',
                        'message': f'Bid too low. Highest bid is currently ₹{float(current_val):,.0f}.'
                    }))
            except Exception as e:
                print(f"Error handling bid in consumer: {e}")
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Failed to process bid. Please try again.'
                }))

    async def bid_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'bid_update',
            'user': event['user'],
            'item_id': event['item_id'],
            'amount': event['amount'],
            'highest_bidder': event.get('highest_bidder', event['user']),
            'end_time': event.get('end_time'),
            'extended': event.get('extended', False),
        }))

    async def auction_ended(self, event):
        await self.send(text_data=json.dumps({
            'type': 'auction_ended',
            'item_id': event['item_id'],
            'winner': event.get('winner'),
            'winning_bid': event.get('winning_bid'),
        }))
