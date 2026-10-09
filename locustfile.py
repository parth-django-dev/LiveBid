# locustfile.py
import json
import time
import random
import requests
from locust import HttpUser, task, between, events
import websocket

BASE_HTTP_URL = "http://127.0.0.1:8000"
BASE_WS_URL = "ws://127.0.0.1:8000"

class LiveAuctionUser(HttpUser):
    wait_time = between(0.5, 2.0)
    host = BASE_HTTP_URL

    def on_start(self):
        """
        Runs when each simulated user spawns:
        1. Authenticates (or creates test session) to obtain sessionid cookie
        2. Discovers active live auctions from the backend
        3. Establishes an authenticated WebSocket connection
        """
        time.sleep(random.uniform(0.1,0.4))
        self.session = requests.Session()
        self.username = f"user_{random.randint(1000, 99999)}"
        self.password = "TestPass@123"
        self.item_id = None
        self.current_price = 1000.0
        self.ws = None

        http_url = (self.host or "http://127.0.0.1:8000").rstrip("/")
        if "vercel.app" in http_url:
            ws_url = "wss://livebid-ti6v.onrender.com"
        else:
            ws_url = http_url.replace("https://", "wss://").replace("http://", "ws://")

        # 1. Register unique user or login existing user
        try:
            reg_res = self.session.post(
                f"{http_url}/api/register/",
                json={
                    "username": self.username,
                    "email": f"{self.username}@test.com",
                    "password": self.password,
                },
                timeout=10
            )
            if reg_res.status_code not in (200, 201):
                # Fallback to pre-existing user if registration exists
                self.session.post(
                    f"{http_url}/api/login/",
                    json={"username": "testuser999", "password": "password123"},
                    timeout=10
                )
        except Exception:
            pass

        session_id = self.session.cookies.get("sessionid")
        self.client.cookies.update(self.session.cookies)
        headers = [f"Cookie: sessionid={session_id}"] if session_id else []

        # 2. Discover active auction items
        try:
            catalog_res = self.session.get(f"{http_url}/api/active-auctions/", timeout=10)
            if catalog_res.status_code == 200:
                auctions = catalog_res.json().get("AuctionList", [])
                live_auctions = [a for a in auctions if a.get("is_live") or a.get("is_active")]
                if live_auctions:
                    chosen = random.choice(live_auctions)
                    self.item_id = chosen["id"]
                    self.current_price = float(chosen.get("current_bid") or chosen.get("start_price") or 1000)
        except Exception:
            pass

        if not self.item_id:
            self.item_id = 11  # fallback to active test item

        # 3. Establish persistent WebSocket connection
        start_conn = time.time()
        try:
            self.ws = websocket.create_connection(
                f"{ws_url}/ws/auction/{self.item_id}/",
                header=headers,
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
        """Simulates catalog browsing traffic (REST API)"""
        self.client.get("/api/active-auctions/", name="REST: get_active_auctions")

    @task(2)
    def inspect_auction_details(self):
        """Simulates viewing room details & bid history (REST API)"""
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
            # Loop until pong is received, safely draining any broadcast updates
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
        self.current_price += random.choice([500, 1000, 2500])
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