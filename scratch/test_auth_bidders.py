import requests
import websocket
import concurrent.futures
import time
import json

BASE_HTTP = "https://live-bid-seven.vercel.app"
BASE_WS = "wss://livebid-ti6v.onrender.com"

# Pre-authenticate 5 sessions
test_users = ['bidder_alpha', 'bidder_beta', 'bidder_gamma', 'bidder_delta', 'bidder_epsilon']
sessions = []
print("Pre-authenticating test sessions...")
for u in test_users:
    s = requests.Session()
    r = s.post(f"{BASE_HTTP}/api/login/", json={"username": u, "password": "Password123!"}, timeout=10)
    sid = s.cookies.get("sessionid")
    if sid:
        sessions.append(sid)
print(f"Authenticated {len(sessions)} sessions.")

def connect_worker(i):
    sid = sessions[i % len(sessions)]
    headers = [
        f"Cookie: sessionid={sid}",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ]
    t0 = time.time()
    try:
        ws = websocket.create_connection(
            f"{BASE_WS}/ws/auction/11/",
            header=headers,
            origin="https://live-bid-seven.vercel.app",
            timeout=15
        )
        # Send ping
        ws.send(json.dumps({"type": "ping"}))
        pong = ws.recv()
        
        # Send bid
        ws.send(json.dumps({"type": "bid", "amount": 90000 + (i * 500)}))
        bid_resp = ws.recv()
        
        elapsed = (time.time() - t0) * 1000
        ws.close()
        return (i, True, elapsed, pong, bid_resp)
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        return (i, False, elapsed, str(e), None)

print("Starting 10 concurrent WebSocket bidders...")
t_start = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(connect_worker, range(10)))

print(f"Total batch time: {(time.time() - t_start)*1000:.1f}ms")
successes = sum(1 for r in results if r[1])
print(f"Successes: {successes}/10")
for r in results:
    print(f"  Worker {r[0]}: ok={r[1]}, time={r[2]:.1f}ms, pong={r[3]}, bid={r[4]}")
