import os
import json
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.contrib.auth.hashers import make_password
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.auth import HASH_SESSION_KEY, SESSION_KEY, BACKEND_SESSION_KEY
from django.utils import timezone
from django.conf import settings
from auctions.models import AuctionItem, Bid
import redis

class Command(BaseCommand):
    help = "Seeds test users, active auctions, and pre-authenticated sessions for scaled k6 load testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--users",
            type=int,
            default=1000,
            help="Number of test users to seed (default: 1000)",
        )
        parser.add_argument(
            "--auctions",
            type=int,
            default=20,
            help="Number of active auctions to seed (default: 20)",
        )
        parser.add_argument(
            "--password",
            type=str,
            default="Password123!",
            help="Password for test users (default: Password123!)",
        )
        parser.add_argument(
            "--start-price",
            type=float,
            default=50000.0,
            help="Starting price for load test auctions (default: 50000.0)",
        )
        parser.add_argument(
            "--clean",
            action="store_true",
            help="Delete existing loadtest users and auctions before seeding",
        )
        parser.add_argument(
            "--reset-state",
            action="store_true",
            help="Reset bids and Redis keys for load test auctions without recreating users",
        )
        parser.add_argument(
            "--output",
            type=str,
            default="loadtest_config.json",
            help="Output JSON config file path (default: loadtest_config.json)",
        )

    def handle(self, *args, **options):
        num_users = options["users"]
        num_auctions = options["auctions"]
        password = options["password"]
        start_price = options["start_price"]
        clean = options["clean"]
        reset_state = options["reset_state"]
        output_file = options["output"]

        self.stdout.write(self.style.MIGRATE_HEADING("=== Seeding LiveBid Load Test Infrastructure ==="))
        self.stdout.write(f"Target Users:    {num_users}")
        self.stdout.write(f"Target Auctions: {num_auctions}")
        self.stdout.write(f"Default Password: {password}")

        # Connect to Redis for key maintenance
        redis_client = None
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            try:
                redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
                self.stdout.write(self.style.SUCCESS("[OK] Connected to Redis for auction cache clearing."))
            except Exception as e:
                self.stdout.write(self.style.WARNING(f"[WARN] Could not connect to Redis: {e}"))

        # Clean previous test entities if requested
        if clean:
            self.stdout.write("Cleaning previous loadtest users and auctions...")
            deleted_bids = Bid.objects.filter(item__title__startswith="LoadTest Item").delete()
            deleted_items = AuctionItem.objects.filter(title__startswith="LoadTest Item").delete()
            deleted_users = User.objects.filter(username__startswith="loadtest_user_").delete()
            self.stdout.write(f"Deleted: {deleted_bids[0]} bids, {deleted_items[0]} auctions, {deleted_users[0]} users.")

        # Ensure seller account exists
        seller, _ = User.objects.get_or_create(
            username="loadtest_seller",
            defaults={"email": "loadtest_seller@test.com", "password": make_password(password)}
        )

        # 1. Seed or update 20 Auctions
        now = timezone.now()
        end_time = now + timedelta(days=3)  # Long end-time so auctions stay live during benchmarks
        existing_items = list(AuctionItem.objects.filter(title__startswith="LoadTest Item").order_by("id"))

        if len(existing_items) < num_auctions:
            needed = num_auctions - len(existing_items)
            self.stdout.write(f"Creating {needed} additional loadtest auctions...")
            new_items = []
            start_idx = len(existing_items) + 1
            for i in range(start_idx, start_idx + needed):
                new_items.append(AuctionItem(
                    seller=seller,
                    title=f"LoadTest Item {i:02d}",
                    description=f"Automated benchmark auction #{i:02d} for distributed scale testing.",
                    start_time=now,
                    end_time=end_time,
                    start_price=start_price,
                    current_bid=start_price,
                    is_active=True,
                ))
            AuctionItem.objects.bulk_create(new_items)
            existing_items = list(AuctionItem.objects.filter(title__startswith="LoadTest Item").order_by("id"))[:num_auctions]
        else:
            existing_items = existing_items[:num_auctions]

        # Reset auction prices and bids if requested or if cleaning
        if clean or reset_state:
            self.stdout.write("Resetting auction bids and prices to base values...")
            item_ids = [item.id for item in existing_items]
            Bid.objects.filter(item_id__in=item_ids).delete()
            for item in existing_items:
                item.current_bid = start_price
                item.winner = None
                item.is_active = True
                item.end_time = end_time
                item.save(update_fields=["current_bid", "winner", "is_active", "end_time"])

                if redis_client:
                    try:
                        redis_prefix = os.getenv("REDIS_KEY_PREFIX", "")
                        redis_client.set(f"{redis_prefix}auction:{item.id}:highest_bid", str(start_price))
                        redis_client.delete(f"{redis_prefix}auction:{item.id}:highest_bidder")
                        redis_client.delete(f"{redis_prefix}auction_details_{item.id}")
                    except Exception as e:
                        self.stdout.write(self.style.WARNING(f"Redis reset error for item {item.id}: {e}"))

            self.stdout.write(self.style.SUCCESS(f"[OK] Reset state for {len(existing_items)} auctions."))

        # 2. Seed Users
        existing_user_count = User.objects.filter(username__startswith="loadtest_user_").count()
        if existing_user_count < num_users:
            self.stdout.write(f"Seeding {num_users - existing_user_count} users (bulk hashed)...")
            hashed_pwd = make_password(password)
            users_to_create = []
            for i in range(1, num_users + 1):
                username = f"loadtest_user_{i:04d}"
                users_to_create.append(User(
                    username=username,
                    email=f"{username}@loadtest.local",
                    password=hashed_pwd,
                    is_active=True,
                ))
            # Bulk create ignoring existing
            User.objects.bulk_create(users_to_create, batch_size=500, ignore_conflicts=True)
            self.stdout.write(self.style.SUCCESS(f"[OK] Successfully ensured {num_users} test users exist."))

        # 3. Create or refresh active session cookies for fast, zero-PBKDF2 k6 execution
        if reset_state and os.path.exists(output_file):
            self.stdout.write("Reusing existing session config from " + output_file)
            with open(output_file, "r") as f:
                prev_config = json.load(f)
            sessions_data = prev_config.get("sessions", [])
            user_credentials = prev_config.get("users", [])
            test_users = list(User.objects.filter(username__startswith="loadtest_user_").order_by("username")[:num_users])
        else:
            self.stdout.write("Generating / verifying pre-authenticated sessions in DB...")
            test_users = list(User.objects.filter(username__startswith="loadtest_user_").order_by("username")[:num_users])

            sessions_data = []
            user_credentials = []

            for user in test_users:
                # Create session store
                s = SessionStore()
                s[SESSION_KEY] = str(user.id)
                s[BACKEND_SESSION_KEY] = 'django.contrib.auth.backends.ModelBackend'
                s[HASH_SESSION_KEY] = user.get_session_auth_hash()
                s.save()

                session_key = s.session_key
                sessions_data.append(session_key)
                user_credentials.append({
                    "username": user.username,
                    "password": password,
                    "sessionid": session_key,
                    "user_id": user.id,
                })

            self.stdout.write(self.style.SUCCESS(f"[OK] Created {len(sessions_data)} valid sessions in django_session."))

        # 4. Export configuration for k6 and reconciliation scripts
        auctions_info = []
        for item in existing_items:
            auctions_info.append({
                "id": item.id,
                "title": item.title,
                "start_price": float(item.start_price),
                "current_bid": float(item.current_bid) if item.current_bid else float(item.start_price),
            })

        config = {
            "created_at": timezone.now().isoformat(),
            "target_users": len(test_users),
            "target_auctions": len(auctions_info),
            "start_price": start_price,
            "password": password,
            "auctions": auctions_info,
            "sessions": sessions_data,
            "users": user_credentials,
        }

        # Write to workspace output file
        with open(output_file, "w") as f:
            json.dump(config, f, indent=2)

        # Also write sessions only file
        with open("loadtest_sessions.json", "w") as f:
            json.dump(sessions_data, f, indent=2)

        self.stdout.write(self.style.SUCCESS(f"[SUCCESS] Load test configuration exported to {output_file} and loadtest_sessions.json"))
        self.stdout.write(f"Active Auctions: {[a['id'] for a in auctions_info]}")
