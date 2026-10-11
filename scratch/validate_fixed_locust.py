import requests
import websocket
import concurrent.futures
import time
import json
import random

BASE_HTTP = "https://live-bid-seven.vercel.app"
BASE_WS = "wss://livebid-ti6v.onrender.com"

# 1. Setup once: Authenticate pool
test_users = ['bidder_alpha', 'bidder_beta', 'bidder_gamma', 'bidder_delta', 'bidder_epsilon']
sessions = []
print("Pre-authenticating 5 test users once...")
for u in test_users:
    s = requests.Session()
    try:
        r = s.post(f"{BASE_HTTP}/api/login/", json={"username": u, "password": "Password123!"}, timeout=15)
        sid = s.cookies.get("sessionid")
        if sid:
            sessions.append(sid)
            print(f"  User '{u}' logged in -> session {sid[:10]}...")
    except Exception as e:
        print(f"  Login failed for {u}: {e}")

print(f"Total sessions ready: {len(sessions)}")

# 2. Simulate 10 concurrent Locust users
def simulate_user(i):
    sid = sessions[i % len(sessions)] if sessions else None
    headers = [
        f"Cookie: sessionid={sid}",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ] if sid else ["User-Agent: Mozilla/5.0"]
    
    t0 = time.time()
    try:
        ws = websocket.create_connection(
            f"{BASE_WS}/ws/auction/11/",
            header=headers,
            origin="https://live-bid-seven.vercel.app",
            timeout=15
        )
        ws.settimeout(15.0)
        connect_time = (time.time() - t0) * 1000
        
        # Ping
        t_ping = time.time()
        ws.send(json.dumps({"type": "ping"}))
        pong = ws.recv()
        ping_time = (time.time() - t_ping) * 1000
        
        # Bid
        t_bid = time.time()
        ws.send(json.dumps({"type": "bid", "amount": 95000 + (i * 500)}))
        bid_resp = ws.recv()
        bid_time = (time.time() - t_bid) * 1000
        
        ws.close()
        return (i, True, connect_time, ping_time, bid_time, pong, bid_resp)
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        return (i, False, elapsed, 0, 0, str(e), None)

print("\nSimulating 10 users spawning concurrently...")
t_batch = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(simulate_user, range(10)))

batch_time = (time.time() - t_batch) * 1000
print(f"\nBatch completed in {batch_time:.1f}ms")
successes = sum(1 for r in results if r[1])
print(f"SUCCESS RATE: {successes}/10 ({successes*10}%)\n")
for r in results:
    if r[1]:
        print(f"User {r[0]}: CONNECT={r[2]:.0f}ms | PING={r[3]:.0f}ms | BID={r[4]:.0f}ms | Resp={r[6]}")
    else:
        print(f"User {r[0]}: FAILED in {r[2]:.0f}ms | Error={r[5]}")
