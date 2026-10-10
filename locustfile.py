# locustfile.py
import json
import time
import random
import requests
from locust import HttpUser, task, between, events
import websocket

BASE_HTTP_URL = "https://live-bid-seven.vercel.app"
BASE_WS_URL = "wss://livebid-ti6v.onrender.com"

# Pre-created test user accounts for load testing
# These accounts avoid hammering Django's PBKDF2 hasher during concurrent user spawns
TEST_ACCOUNTS = [
    {"username": "bidder_alpha", "password": "Password123!"},
    {"username": "bidder_beta", "password": "Password123!"},
    {"username": "bidder_gamma", "password": "Password123!"},
    {"username": "bidder_delta", "password": "Password123!"},
    {"username": "bidder_epsilon", "password": "Password123!"},
]

# Shared pool of authenticated session cookies populated at test initialization
AUTHENTICATED_SESSIONS = []
ACTIVE_AUCTION_CACHE = {"item_id": 15, "current_price": 100000.0}

SESSIONS_FILE = ".locust_sessions.json"

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """
    Runs ONCE before simulated users spawn.
    1. Loads pre-authenticated sessions from file (or logins once and saves them).
    2. Fetches current active live auctions to find the active room ID.
    """
    global AUTHENTICATED_SESSIONS, ACTIVE_AUCTION_CACHE
    AUTHENTICATED_SESSIONS.clear()

    host = environment.host or BASE_HTTP_URL
    http_url = host.rstrip("/")

    print(f"\n[Locust Init] Warmup started against {http_url}...")

    # Load from cached file if exists
    import os
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE) as f:
                saved = json.load(f)
                AUTHENTICATED_SESSIONS.extend(saved.values())
                print(f"[Locust Init] Loaded {len(AUTHENTICATED_SESSIONS)} cached sessions from {SESSIONS_FILE}.")
        except Exception as e:
            print(f"[Locust Init] Could not read {SESSIONS_FILE}: {e}")

    # Fallback to login if empty
    if not AUTHENTICATED_SESSIONS:
        fresh = {}
        for creds in TEST_ACCOUNTS:
            s = requests.Session()
            try:
                res = s.post(
                    f"{http_url}/api/login/",
                    json={"username": creds["username"], "password": creds["password"]},
                    timeout=10
                )
                sid = s.cookies.get("sessionid")
                if sid:
                    AUTHENTICATED_SESSIONS.append(sid)
                    fresh[creds["username"]] = sid
                    print(f"  [Auth Pool] Logged in '{creds['username']}' -> session ready")
            except Exception as e:
                print(f"  [Auth Pool] Login failed for '{creds['username']}': {e}")
        try:
            with open(SESSIONS_FILE, "w") as f:
                json.dump(fresh, f, indent=2)
        except Exception:
            pass

    print(f"[Locust Init] Ready with {len(AUTHENTICATED_SESSIONS)} active sessions.")

    # 2. Discover active live auctions
    try:
        cat_res = requests.get(f"{http_url}/api/active-auctions/", timeout=10)
        if cat_res.status_code == 200:
            auctions = cat_res.json().get("AuctionList", [])
            live = [a for a in auctions if a.get("is_live") or a.get("is_active")]
            if live:
                chosen = live[0]
                ACTIVE_AUCTION_CACHE["item_id"] = chosen["id"]
                ACTIVE_AUCTION_CACHE["current_price"] = float(chosen.get("current_bid") or chosen.get("start_price") or 10000)
                print(f"[Locust Init] Target live auction selected: Item {chosen['id']} ('{chosen['title']}') @ Rs.{ACTIVE_AUCTION_CACHE['current_price']}")
    except Exception as e:
        print(f"[Locust Init] Could not discover live auctions: {e}. Defaulting to Item 15.")


class LiveAuctionUser(HttpUser):
    wait_time = between(0.5, 2.0)
    host = BASE_HTTP_URL

    def on_start(self):
        """
        Runs when each simulated user spawns:
        Draws an authenticated session from the pre-warmed pool and opens the WebSocket.
        """
        # Stagger user start slightly
        time.sleep(random.uniform(0.1, 0.5))

        http_url = (self.host or BASE_HTTP_URL).rstrip("/")
        if "vercel.app" in http_url:
            ws_url = BASE_WS_URL
        elif "onrender.com" in http_url:
            ws_url = http_url.replace("https://", "wss://").replace("http://", "ws://")
        else:
            ws_url = "ws://127.0.0.1:8000"

        # Assign session from pool or login fallback
        global AUTHENTICATED_SESSIONS
        self.session_id = None
        if AUTHENTICATED_SESSIONS:
            self.session_id = random.choice(AUTHENTICATED_SESSIONS)
            self.client.cookies.set("sessionid", self.session_id)
        else:
            # Fallback if pool is empty: login directly
            try:
                login_res = self.client.post(
                    "/api/login/",
                    json={"username": "bidder_alpha", "password": "Password123!"},
                    timeout=10
                )
                self.session_id = self.client.cookies.get("sessionid")
            except Exception:
                pass

        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        headers = [f"Cookie: sessionid={self.session_id}", f"User-Agent: {user_agent}"] if self.session_id else [f"User-Agent: {user_agent}"]

        self.item_id = ACTIVE_AUCTION_CACHE.get("item_id", 15)
        self.current_price = ACTIVE_AUCTION_CACHE.get("current_price", 100000.0)
        self.ws = None

        # Establish persistent WebSocket connection
        start_conn = time.time()
        try:
            self.ws = websocket.create_connection(
                f"{ws_url}/ws/auction/{self.item_id}/",
                header=headers,
                origin="https://live-bid-seven.vercel.app",
                timeout=15
            )
            self.ws.settimeout(15.0)
            events.request.fire(
                request_type="WS",
                name="WS: connect_room",
                response_time=(time.time() - start_conn) * 1000,
                response_length=0,
                exception=None
            )
        except Exception as e:
            events.request.fire(
                request_type="WS",
                name="WS: connect_room",
                response_time=(time.time() - start_conn) * 1000,
                response_length=0,
                exception=e
            )

    @task(3)
    def browse_catalog(self):
        """Simulates catalog browsing traffic (REST API with Redis caching)"""
        self.client.get("/api/active-auctions/", name="REST: get_active_auctions")

    @task(2)
    def inspect_auction_details(self):
        """Simulates viewing room details & bid history (REST API with Redis caching)"""
        if self.item_id:
            self.client.get(f"/api/auction/{self.item_id}/", name="REST: get_auction_details")

    @task(4)
    def ws_heartbeat_ping(self):
        """Measures pure WebSocket ASGI latency (Ping/Pong)"""
        if not self.ws:
            return
        start = time.time()
        try:
            self.ws.settimeout(15.0)
            self.ws.send(json.dumps({"type": "ping"}))
            while True:
                res = self.ws.recv()
                data = json.loads(res) if res else {}
                if data.get("type") == "pong":
                    break
            duration = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="WS: heartbeat_ping",
                response_time=duration,
                response_length=len(res) if res else 0,
                exception=None
            )
        except Exception as e:
            events.request.fire(
                request_type="WS",
                name="WS: heartbeat_ping",
                response_time=(time.time() - start) * 1000,
                response_length=0,
                exception=e
            )

    @task(1)
    def ws_place_bid(self):
        """Places a competitive bid via WebSocket Channels"""
        if not self.ws:
            return
        start = time.time()
        self.current_price += random.choice([5000, 10000])
        try:
            self.ws.settimeout(15.0)
            self.ws.send(json.dumps({
                "type": "bid",
                "amount": self.current_price
            }))
            # Drain until we get our bid response or error
            while True:
                res = self.ws.recv()
                data = json.loads(res) if res else {}
                if data.get("type") in ("bid_update", "error"):
                    break
            duration = (time.time() - start) * 1000
            msg = data.get("message", "")
            is_valid = (
                data.get("type") == "bid_update"
                or "highest bidder" in msg
                or "Bid too low" in msg
                or "Minimum increment" in msg
                or "ended" in msg
            )
            exc = None if is_valid else Exception(msg or "Bid error")
            events.request.fire(
                request_type="WS",
                name="WS: place_bid",
                response_time=duration,
                response_length=len(res) if res else 0,
                exception=exc
            )
        except Exception as e:
            events.request.fire(
                request_type="WS",
                name="WS: place_bid",
                response_time=(time.time() - start) * 1000,
                response_length=0,
                exception=e
            )

    def on_stop(self):
        """Cleanly close WebSocket on user teardown"""
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass