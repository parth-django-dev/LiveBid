import websocket
import concurrent.futures
import time
import json

def connect_one(i):
    url = "wss://livebid-ti6v.onrender.com/ws/auction/11/"
    t0 = time.time()
    try:
        ws = websocket.create_connection(
            url,
            header=["User-Agent: Mozilla/5.0"],
            origin="https://live-bid-parth-django-devs-projects.vercel.app",
            timeout=15
        )
        ws.send(json.dumps({"type": "ping"}))
        res = ws.recv()
        elapsed = (time.time() - t0) * 1000
        ws.close()
        return (i, True, elapsed, res)
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        return (i, False, elapsed, str(e))

if __name__ == "__main__":
    print("Testing 10 concurrent WebSocket connections to Render...")
    t_start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(connect_one, range(10)))
    total = (time.time() - t_start) * 1000
    print(f"Total test time: {total:.1f}ms")
    successes = sum(1 for r in results if r[1])
    print(f"Successes: {successes}/10")
    for r in results:
        print(f"  Worker {r[0]}: success={r[1]}, time={r[2]:.1f}ms, response={r[3]}")
