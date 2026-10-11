import requests
import websocket
import concurrent.futures
import time
import random

BASE_HTTP = "https://live-bid-seven.vercel.app"
BASE_WS = "wss://livebid-ti6v.onrender.com"

def simulate_locust_user(i):
    s = requests.Session()
    username = f"locust_test_{i}_{int(time.time())}"
    password = "TestPassword@123"
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    
    t0 = time.time()
    # 1. Register
    reg_res = s.post(
        f"{BASE_HTTP}/api/register/",
        json={"username": username, "email": f"{username}@test.com", "password": password},
        headers={"User-Agent": user_agent},
        timeout=15
    )
    t_reg = (time.time() - t0) * 1000
    
    session_id = s.cookies.get("sessionid")
    headers = [f"Cookie: sessionid={session_id}", f"User-Agent: {user_agent}"] if session_id else [f"User-Agent: {user_agent}"]
    
    # 2. Get active auctions
    t1 = time.time()
    cat_res = s.get(f"{BASE_HTTP}/api/active-auctions/", headers={"User-Agent": user_agent}, timeout=15)
    t_cat = (time.time() - t1) * 1000
    
    # 3. Connect WebSocket
    t2 = time.time()
    try:
        ws = websocket.create_connection(
            f"{BASE_WS}/ws/auction/11/",
            header=headers,
            origin="https://live-bid-seven.vercel.app",
            timeout=15
        )
        ws.send('{"type":"ping"}')
        res = ws.recv()
        t_ws = (time.time() - t2) * 1000
        ws.close()
        return (i, True, t_reg, t_cat, t_ws, res)
    except Exception as e:
        t_ws = (time.time() - t2) * 1000
        return (i, False, t_reg, t_cat, t_ws, str(e))

if __name__ == "__main__":
    print("Testing 10 simultaneous Locust-style user flows...")
    t_all = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(simulate_locust_user, range(10)))
    total = (time.time() - t_all) * 1000
    print(f"Total time: {total:.1f}ms")
    for r in results:
        print(f"User {r[0]}: ws_ok={r[1]} | reg={r[2]:.0f}ms | cat={r[3]:.0f}ms | ws={r[4]:.0f}ms | resp={r[5]}")
