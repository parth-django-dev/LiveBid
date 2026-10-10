import json
import time
from datetime import timedelta
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Prefetch
from .models import AuctionItem, Bid
from django.core.cache import cache

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

def auto_finalize_expired_item(item, now):
    """Auto-finalize item if end_time has passed, ensuring DB consistency without Celery."""
    if item.is_active and item.end_time <= now:
        bids = list(item.bids.all())
        if bids:
            highest_bid = bids[0]
            item.winner = highest_bid.user
            item.current_bid = highest_bid.amount
        item.is_active = False
        item.save(update_fields=['is_active', 'winner', 'current_bid'])

# Resource Retrieval views
def active_auctions(request):
    t_start = time.time()
    cache_key = "active_auctions_list"
    cached_data = cache.get(cache_key)

    if cached_data is not None:
        total_t = time.time() - t_start
        print(f"[PERF:active_auctions] CACHE_HIT total={total_t*1000:.1f}ms", flush=True)
        return JsonResponse(cached_data)

    now = timezone.now()

    # Measure DB query time
    t_db_start = time.time()
    items = list(AuctionItem.objects.select_related('seller', 'winner').prefetch_related(
        Prefetch('bids', queryset=Bid.objects.select_related('user').order_by('-amount'))
    ).order_by('-id'))
    t_db = time.time() - t_db_start

    # Measure serialization time
    t_proc_start = time.time()
    AuctionList = []
    for item in items:
        auto_finalize_expired_item(item, now)
        bids = list(item.bids.all())
        highest_bid_obj = bids[0] if bids else None
        highest_bidder = highest_bid_obj.user.username if highest_bid_obj else None
        current_highest = float(highest_bid_obj.amount) if highest_bid_obj else float(item.start_price)
        is_live = bool(item.is_active and item.end_time > now)
        winner = item.winner.username if item.winner else (highest_bidder if not is_live else None)

        AuctionList.append({
            'id': item.id,
            'title': item.title,
            'description': item.description,
            'image': request.build_absolute_uri(item.image.url) if item.image else None,
            'start_time': item.start_time.isoformat() if hasattr(item.start_time, 'isoformat') else str(item.start_time),
            'end_time': item.end_time.isoformat() if hasattr(item.end_time, 'isoformat') else str(item.end_time),
            'start_price': float(item.start_price),
            'current_bid': current_highest,
            'highest_bidder': highest_bidder,
            'seller': item.seller.username if item.seller else None,
            'is_active': item.is_active,
            'is_live': is_live,
            'winner': winner,
        })
    t_proc = time.time() - t_proc_start
    total_t = time.time() - t_start

    response_data = {'AuctionList': AuctionList}
    cache.set(cache_key, response_data, timeout=3)  # 3-second TTL

    print(f"[PERF:active_auctions] CACHE_MISS total={total_t*1000:.1f}ms | db={t_db*1000:.1f}ms | proc={t_proc*1000:.1f}ms | items={len(items)}", flush=True)

    return JsonResponse(response_data)

def auction_details(request, id):
    t_start = time.time()
    cache_key = f"auction_details_{id}"
    cached_data = cache.get(cache_key)

    if cached_data is not None:
        total_t = time.time() - t_start
        print(f"[PERF:auction_details:{id}] CACHE_HIT total={total_t*1000:.1f}ms", flush=True)
        return JsonResponse(cached_data)

    # Measure DB query time
    t_db_start = time.time()
    item = get_object_or_404(
        AuctionItem.objects.select_related('seller', 'winner').prefetch_related(
            Prefetch('bids', queryset=Bid.objects.select_related('user').order_by('-bid_time'))
        ),
        pk=id
    )
    # Limit bids to latest 20 to avoid unbounded JSON payloads
    item_bids = list(item.bids.all()[:20])
    t_db = time.time() - t_db_start

    # Measure processing time
    t_proc_start = time.time()
    now = timezone.now()
    auto_finalize_expired_item(item, now)

    # Bids on the item ordered by bid_time descending
    bids_List = []
    for bid in item_bids:
        bids_List.append({
            'id': bid.id,
            'user': bid.user.username,
            'amount': float(bid.amount),
            'bid_time': bid.bid_time.isoformat()
        })

    # True leader is the highest bid
    highest_bid_obj = max(item_bids, key=lambda b: b.amount) if item_bids else None
    highest_bidder = highest_bid_obj.user.username if highest_bid_obj else None
    current_highest = float(highest_bid_obj.amount) if highest_bid_obj else float(item.start_price)

    is_live = bool(item.is_active and item.end_time > now)
    winner = item.winner.username if item.winner else (highest_bidder if not is_live else None)
    min_step = get_minimum_step(current_highest)
    min_next_bid = current_highest + min_step
    t_proc = time.time() - t_proc_start
    total_t = time.time() - t_start

    detail_data = {
        'id': item.id,
        'title': item.title,
        'description': item.description,
        'image': request.build_absolute_uri(item.image.url) if item.image else None,
        'start_time': item.start_time.isoformat(),
        'end_time': item.end_time.isoformat(),
        'start_price': float(item.start_price),
        'current_bid': current_highest,
        'current_price': current_highest,
        'min_step': min_step,
        'min_next_bid': min_next_bid,
        'highest_bidder': highest_bidder,
        'seller': item.seller.username if item.seller else None,
        'is_active': item.is_active,
        'is_live': is_live,
        'winner': winner,
        'bids_List': bids_List
    }

    cache.set(cache_key, detail_data, timeout=3)  # 3-second TTL

    print(f"[PERF:auction_details:{id}] CACHE_MISS total={total_t*1000:.1f}ms | db={t_db*1000:.1f}ms | proc={t_proc*1000:.1f}ms | bids_count={len(item_bids)}", flush=True)

    return JsonResponse(detail_data)

def my_bids(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication required'}, status=401)

    now = timezone.now()
    # Find all items where the user has placed bids, optimized with prefetch
    bid_items = AuctionItem.objects.filter(bids__user=request.user).distinct().select_related(
        'seller', 'winner'
    ).prefetch_related(
        Prefetch('bids', queryset=Bid.objects.select_related('user').order_by('-amount'))
    ).order_by('-id')

    items_data = []
    for item in bid_items:
        auto_finalize_expired_item(item, now)
        bids = list(item.bids.all())
        user_bids = [b for b in bids if b.user_id == request.user.id]
        my_bid_val = float(user_bids[0].amount) if user_bids else 0.0

        highest_bid_obj = bids[0] if bids else None
        highest_bidder = highest_bid_obj.user.username if highest_bid_obj else None
        current_highest = float(highest_bid_obj.amount) if highest_bid_obj else float(item.start_price)

        is_live = bool(item.is_active and item.end_time > now)
        is_leading = (highest_bidder == request.user.username)
        is_winner = bool((not is_live) and (item.winner == request.user or highest_bidder == request.user.username))

        items_data.append({
            'id': item.id,
            'title': item.title,
            'description': item.description,
            'image': request.build_absolute_uri(item.image.url) if item.image else None,
            'start_time': item.start_time.isoformat(),
            'end_time': item.end_time.isoformat(),
            'start_price': float(item.start_price),
            'current_bid': current_highest,
            'highest_bidder': highest_bidder,
            'my_highest_bid': my_bid_val,
            'is_live': is_live,
            'is_leading': is_leading,
            'is_winner': is_winner,
        })

    return JsonResponse({'bids': items_data})

def my_listings(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication required'}, status=401)

    now = timezone.now()
    items = AuctionItem.objects.filter(seller=request.user).select_related(
        'seller', 'winner'
    ).prefetch_related(
        Prefetch('bids', queryset=Bid.objects.select_related('user').order_by('-amount'))
    ).order_by('-id')

    items_data = []
    for item in items:
        auto_finalize_expired_item(item, now)
        bids = list(item.bids.all())
        highest_bid_obj = bids[0] if bids else None
        highest_bidder = highest_bid_obj.user.username if highest_bid_obj else None
        current_highest = float(highest_bid_obj.amount) if highest_bid_obj else float(item.start_price)
        is_live = bool(item.is_active and item.end_time > now)

        items_data.append({
            'id': item.id,
            'title': item.title,
            'description': item.description,
            'image': request.build_absolute_uri(item.image.url) if item.image else None,
            'start_time': item.start_time.isoformat(),
            'end_time': item.end_time.isoformat(),
            'start_price': float(item.start_price),
            'current_bid': current_highest,
            'highest_bidder': highest_bidder,
            'is_live': is_live,
            'winner': item.winner.username if item.winner else (highest_bidder if not is_live else None),
        })

    return JsonResponse({'listings': items_data})

@csrf_exempt
def create_auction(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    title = request.POST.get('title', '').strip()
    description = request.POST.get('description', '').strip()
    start_price_raw = request.POST.get('start_price')
    duration_hours_raw = request.POST.get('duration_hours')
    end_time_raw = request.POST.get('end_time')
    image_file = request.FILES.get('image')

    if not title or not description or not start_price_raw:
        return JsonResponse({'error': 'Title, description, and starting price are required.'}, status=400)

    try:
        start_price = float(start_price_raw)
        if start_price <= 0:
            return JsonResponse({'error': 'Starting price must be greater than 0.'}, status=400)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid starting price format.'}, status=400)

    now = timezone.now()

    if end_time_raw:
        try:
            end_time = parse_datetime(end_time_raw)
            if not end_time:
                from datetime import datetime
                end_time = datetime.fromisoformat(end_time_raw)
            if timezone.is_naive(end_time):
                end_time = timezone.make_aware(end_time)
            if end_time <= now:
                return JsonResponse({'error': 'End time must be in the future.'}, status=400)
        except Exception:
            return JsonResponse({'error': 'Invalid end time format.'}, status=400)
    elif duration_hours_raw:
        try:
            hours = float(duration_hours_raw)
            end_time = now + timedelta(hours=hours)
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid duration format.'}, status=400)
    else:
        end_time = now + timedelta(hours=24)

    try:
        seller_user = request.user if (hasattr(request, 'user') and request.user.is_authenticated) else None

        item = AuctionItem.objects.create(
            seller=seller_user,
            title=title,
            description=description,
            image=image_file,
            start_time=now,
            end_time=end_time,
            start_price=start_price,
            current_bid=start_price,
            is_active=True
        )

        image_url = None
        if item.image:
            try:
                image_url = item.image.url
            except Exception:
                image_url = None

        return JsonResponse({
            'message': 'Auction listed successfully!',
            'item': {
                'id': item.id,
                'title': item.title,
                'description': item.description,
                'image': image_url,
                'start_price': float(item.start_price),
                'current_bid': float(item.current_bid),
                'end_time': item.end_time.isoformat(),
                'is_live': True
            }
        }, status=201)
    except Exception as e:
        return JsonResponse({'error': f'Failed to create auction: {str(e)}'}, status=500)

# Authentication and Session management views
def get_current_user(request):
    if request.user.is_authenticated:
        return JsonResponse({
            'authenticated': True,
            'user': {
                'id': request.user.id,
                'username': request.user.username,
                'email': request.user.email
            }
        })
    return JsonResponse({'authenticated': False, 'user': None})

def get_csrf_token(request):
    return JsonResponse({'csrfToken': get_token(request)})

@csrf_exempt
def register_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    
    try:
        data = json.loads(request.body)
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Invalid request body'}, status=400)

    if not username or not email or not password:
        return JsonResponse({'error': 'Missing required fields'}, status=400)

    if User.objects.filter(username=username).exists():
        return JsonResponse({'error': 'Username already taken'}, status=400)

    # Password complexity validation
    try:
        validate_password(password)
    except DjangoValidationError as e:
        return JsonResponse({'error': ' '.join(e.messages)}, status=400)

    user = User.objects.create_user(username=username, email=email, password=password)
    login(request, user)
    return JsonResponse({
        'message': 'User registered successfully',
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email
        }
    }, status=201)

@csrf_exempt
def login_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body)
        username = data.get('username')
        password = data.get('password')
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Invalid request body'}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is not None:
        login(request, user)
        return JsonResponse({'message': 'Login successful'})
    else:
        return JsonResponse({'error': 'Invalid credentials'}, status=401)

@csrf_exempt
def logout_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    
    logout(request)
    return JsonResponse({'message': 'Logged out successfully'})