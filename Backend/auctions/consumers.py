import os
import json
import asyncio
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

redis_client = aioredis.Redis(connection_pool=REDIS_POOL)

# High-concurrency in-memory caches to eliminate WAN database queries during real-time auctions
AUCTION_METADATA_CACHE = {}
USER_SESSION_CACHE = {}

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
def _fetch_auction_info_from_db(item_id):
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

async def get_auction_info(item_id):
    item_key = str(item_id)
    if item_key in AUCTION_METADATA_CACHE:
        return AUCTION_METADATA_CACHE[item_key]
    info = await _fetch_auction_info_from_db(item_id)
    if info:
        AUCTION_METADATA_CACHE[item_key] = info
    return info

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

@database_sync_to_async
def _fetch_user_from_session_db(session_key):
    try:
        from django.contrib.sessions.models import Session
        from django.contrib.auth.models import User
        session = Session.objects.filter(session_key=session_key).first()
        if not session:
            return None
        data = session.get_decoded()
        user_id = data.get('_auth_user_id')
        if user_id:
            return User.objects.filter(pk=user_id).first()
    except Exception as e:
        print(f"Error resolving session user: {e}")
    return None

async def get_user_from_session_key(session_key):
    if not session_key:
        return None
    if session_key in USER_SESSION_CACHE:
        return USER_SESSION_CACHE[session_key]
    user = await _fetch_user_from_session_db(session_key)
    if user:
        USER_SESSION_CACHE[session_key] = user
    return user

async def persist_bid_async(user, item_id, amount, channel_layer, group_name):
    """Background task: saves bid to PostgreSQL and checks anti-sniping without blocking WebSocket."""
    try:
        await record_bid(user, item_id, amount)
        new_end_time = await check_and_extend_auction(item_id)
        item_key = str(item_id)
        if new_end_time and item_key in AUCTION_METADATA_CACHE:
            AUCTION_METADATA_CACHE[item_key]['end_time'] = new_end_time
        
        # Invalidate Redis REST cache so catalog updates immediately on new bids
        try:
            from django.core.cache import cache
            cache.delete(f"auction_details_{item_id}")
            cache.delete("active_auctions_list")
        except Exception as cache_err:
            print(f"Warning: Failed to invalidate REST cache: {cache_err}")
    except Exception as e:
        print(f"Background DB persist error for item {item_id}: {e}")

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
            self.redis = redis_client

            # Accept WebSocket handshake immediately (< 5ms response time)
            await self.accept()

            # Join room group for live broadcasts
            await self.channel_layer.group_add(
                self.group_name,
                self.channel_name
            )

            # Check cache in Redis first to avoid DB queries per viewer
            cached_bid = None
            try:
                cached_bid = await self.redis.get(self.redis_bid_key)
            except Exception as cache_err:
                print(f"Warning: Redis cache get skipped: {cache_err}")

            # If cache miss (first client joining this room), load DB info and seed Redis
            if cached_bid is None:
                item_info = await get_auction_info(self.item_id)
                if item_info is None:
                    await self.close()
                    return

                if item_info['is_active']:
                    try:
                        await self.redis.set(self.redis_bid_key, str(item_info['current_bid']))
                        if item_info.get('highest_bidder'):
                            await self.redis.set(self.redis_bidder_key, item_info['highest_bidder'])
                    except Exception as cache_err:
                        print(f"Warning: Redis cache sync skipped: {cache_err}")

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

    async def get_current_user(self):
        if hasattr(self, '_authenticated_user') and self._authenticated_user:
            return self._authenticated_user

        scope_user = self.scope.get('user')
        if scope_user and getattr(scope_user, 'is_authenticated', False):
            self._authenticated_user = scope_user
            return scope_user

        cookies = self.scope.get('cookies', {})
        session_id = cookies.get('sessionid')
        if session_id:
            user = await get_user_from_session_key(session_id)
            if user:
                self._authenticated_user = user
                return user

        return None

    async def receive(self, text_data):
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

        user = await self.get_current_user()
        if not user or not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Authentication required to place a bid. Please log in.'
            }))
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

                # Check minimum increment step against Redis current highest bid
                cached_bid = await self.redis.get(self.redis_bid_key)
                if cached_bid is not None:
                    current_highest = float(cached_bid)
                else:
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
                    # Offload PostgreSQL persistence to background task so WebSocket clients are never blocked by WAN database latency
                    asyncio.create_task(persist_bid_async(user, self.item_id, amount, self.channel_layer, self.group_name))

                    bid_payload = {
                        'type': 'bid_update',
                        'user': user.username,
                        'item_id': self.item_id,
                        'amount': str(amount),
                        'highest_bidder': user.username,
                        'end_time': item_info.get('end_time'),
                        'extended': False,
                        'sender_channel': self.channel_name,
                    }

                    # 1. Immediately acknowledge the winning bidder over local socket (< 2ms)
                    await self.send(text_data=json.dumps(bid_payload))

                    # 2. Fan out to other room viewers asynchronously via Redis Pub/Sub in the background
                    asyncio.create_task(self.channel_layer.group_send(self.group_name, bid_payload))
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
        # Skip duplicate frame for the winning bidder who was already directly acknowledged
        if event.get('sender_channel') == self.channel_name:
            return

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
