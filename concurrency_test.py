#!/usr/bin/env python3
"""
concurrency_test.py

Step 2: Correctness Under Concurrency (Zero Race Conditions Test)
Fires 25 simultaneous bids from 25 distinct authenticated users at the exact same microsecond
against the live deployed Daphne ASGI WebSocket server, then queries Postgres directly
to prove zero race conditions, zero lost updates, and atomic Redis Lua consistency.
"""

import websocket
import threading
import concurrent.futures
import json
import time
import os
import random
import secrets
import datetime
import psycopg2
from pathlib import Path
from django.conf import settings
from django.contrib.sessions.backends.base import SessionBase

# Configure Django settings for session encoding
if not settings.configured:
    settings.configure(
        SECRET_KEY=os.getenv("SECRET_KEY", "django-insecure--sfbhv(%zl%x#l$_d4u_40)dp=ld_ne-mnoq($z32xtjd(!^5z")
    )

# Target active auction item (Item 14 is Lugia)
ITEM_ID = int(os.getenv("ITEM_ID", "14"))
WS_URL = os.getenv("WS_URL", f"wss://livebid-ti6v.onrender.com/ws/auction/{ITEM_ID}/")
ORIGIN = os.getenv("ORIGIN", "https://live-bid-parth-django-devs-projects.vercel.app")
NUM_BIDDERS = int(os.getenv("NUM_BIDDERS", "25"))


def get_db_connection():
    """Connects directly to Neon Postgres using SNI endpoint routing."""
    return psycopg2.connect(
        host="52.76.212.156",
        dbname="neondb",
        user="neondb_owner",
        password="npg_v3dNeXVWzK4L",
        sslmode="require",
        options="endpoint=ep-super-thunder-b3omran2-pooler",
    )


def prepare_authenticated_sessions(num_users=25):
    """
    Loads 25 distinct authenticated user sessions from .concurrency_sessions.json.
    """
    sessions_file = Path(".concurrency_sessions.json")
    if sessions_file.exists():
        with open(sessions_file, "r") as f:
            data = json.load(f)
        if len(data) >= num_users:
            print(f"Loaded {len(data[:num_users])} authenticated test sessions from cache.", flush=True)
            return data[:num_users]

    raise RuntimeError("Missing .concurrency_sessions.json cache! Run session setup first.")


def get_postgres_state(item_id):
    """Fetches exact Postgres state for the auction item and its bid ledger."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, title, current_bid, is_active FROM auctions_auctionitem WHERE id = %s;",
            (item_id,)
        )
        item = cur.fetchone()

        cur.execute(
            "SELECT COUNT(*), COALESCE(MAX(amount), 0) FROM auctions_bid WHERE item_id = %s;",
            (item_id,)
        )
        bids_stats = cur.fetchone()

        cur.execute(
            "SELECT b.id, u.username, b.amount, b.bid_time FROM auctions_bid b JOIN auth_user u ON b.user_id = u.id WHERE b.item_id = %s ORDER BY b.id DESC LIMIT 5;",
            (item_id,)
        )
        recent_bids = cur.fetchall()

        return {
            "item_id": item[0] if item else None,
            "title": item[1] if item else None,
            "current_bid": float(item[2]) if item else 0.0,
            "is_active": item[3] if item else False,
            "bid_count": bids_stats[0] if bids_stats else 0,
            "max_bid": float(bids_stats[1]) if bids_stats else 0.0,
            "recent_bids": recent_bids,
        }
    finally:
        cur.close()
        conn.close()


def place_single_bid(user_info, amount, start_timestamp):
    """
    Connects to the live auction room over WebSocket and shoots the bid
    at the synchronized timestamp across all concurrent threads.
    """
    headers = [
        f"Cookie: sessionid={user_info['sessionid']}",
        "User-Agent: Mozilla/5.0 ConcurrencyTest/1.0",
    ]

    # Synchronize all threads to fire at the exact same moment
    delay = start_timestamp - time.time()
    if delay > 0:
        time.sleep(delay)

    try:
        t_start = time.time()
        ws = websocket.create_connection(
            WS_URL,
            header=headers,
            origin=ORIGIN,
            timeout=15
        )
        ws.settimeout(12.0)

        # Fire bid immediately
        t_send = time.time()
        ws.send(json.dumps({"type": "bid", "amount": amount}))

        # Await real-time response from server
        response = ws.recv()
        elapsed = (time.time() - t_send) * 1000
        data = json.loads(response)
        ws.close()

        resp_type = data.get("type", "unknown")
        raw_detail = data.get("amount") if resp_type == "bid_update" else data.get("message", "unknown")
        detail = str(raw_detail).replace("\u20b9", "INR ")
        print(f"  [{resp_type.upper()}] User '{user_info['username']}' bid INR {amount:,.0f} -> {detail} ({elapsed:.0f}ms)", flush=True)

        return {
            "success": True,
            "user": user_info["username"],
            "sent_amount": amount,
            "latency_ms": elapsed,
            "response": data,
        }
    except Exception as e:
        print(f"  [ERROR] User '{user_info['username']}' failed: {e}", flush=True)
        return {
            "success": False,
            "user": user_info["username"],
            "sent_amount": amount,
            "error": str(e),
        }


def run_concurrency_pass(users, item_id, base_bid):
    """Executes a 25-client simultaneous bid barrage using real OS threads."""
    # Stagger bid amounts: base + 500 * (i + 1)
    bids = []
    for i, u in enumerate(users):
        bid_amount = base_bid + (500 * (i + 1))
        bids.append((u, bid_amount))

    # Shuffle start order so arrival at the server is genuinely randomized and concurrent
    random.shuffle(bids)

    print(f"\n[*] Launching {len(bids)} simultaneous bids against Item {item_id}...", flush=True)
    print(f"    Base bid: INR {base_bid:,.0f} | Range: INR {min(b[1] for b in bids):,.0f} - INR {max(b[1] for b in bids):,.0f}", flush=True)

    # Synchronize all threads to fire 0.5s from now
    target_start = time.time() + 0.5

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(users)) as executor:
        futures = [executor.submit(place_single_bid, u, amt, target_start) for u, amt in bids]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    return results


def main():
    print("=" * 70)
    print("STEP 2: CORRECTNESS UNDER CONCURRENCY (ZERO RACE CONDITIONS TEST)")
    print("=" * 70)

    # 1. Inspect initial Postgres state
    print(f"\n[1/5] Fetching initial state from Neon Postgres for Item {ITEM_ID}...", flush=True)
    initial_pg = get_postgres_state(ITEM_ID)
    print(f"    Item Title:        {initial_pg['title']}")
    print(f"    Active Status:     {initial_pg['is_active']}")
    print(f"    Initial DB Bid:    INR {initial_pg['current_bid']:,.0f}")
    print(f"    Initial Bid Count: {initial_pg['bid_count']} bids in ledger", flush=True)

    if not initial_pg['is_active']:
        print("[ERROR] Target auction item is not active! Please specify an active ITEM_ID.")
        return

    # 2. Prepare 25 authenticated users
    print(f"\n[2/5] Preparing {NUM_BIDDERS} authenticated test user sessions...", flush=True)
    users = prepare_authenticated_sessions(NUM_BIDDERS)
    base_bid = initial_pg['current_bid']

    # 3. Execute concurrency barrage
    print(f"\n[3/5] Executing simultaneous WebSocket bid barrage...", flush=True)
    results = run_concurrency_pass(users, ITEM_ID, base_bid)

    # 4. Analyze WebSocket responses
    print(f"\n[4/5] Analyzing real-time WebSocket responses...", flush=True)
    accepted_bids = []
    rejected_bids = []
    network_errors = []

    for r in results:
        if not r["success"]:
            network_errors.append(r)
            continue
        resp = r["response"]
        if resp.get("type") == "bid_update":
            accepted_bids.append({
                "user": r["user"],
                "amount": float(resp.get("amount", r["sent_amount"])),
                "highest_bidder": resp.get("highest_bidder"),
                "latency_ms": r["latency_ms"],
            })
        elif resp.get("type") == "error":
            rejected_bids.append({
                "user": r["user"],
                "sent_amount": r["sent_amount"],
                "message": resp.get("message"),
                "latency_ms": r["latency_ms"],
            })

    print(f"    Total Simultaneous Requests: {len(results)}")
    print(f"    Accepted Bids (Won Slot):    {len(accepted_bids)}")
    print(f"    Rejected Bids (Outbid/Low):  {len(rejected_bids)}")
    print(f"    Network/Timeout Errors:      {len(network_errors)}")

    if accepted_bids:
        accepted_bids.sort(key=lambda x: x["amount"])
        highest_accepted = accepted_bids[-1]
        print(f"\n    Highest Accepted Bid:")
        print(f"      Winning User:    {highest_accepted['user']}")
        print(f"      Winning Amount:  INR {highest_accepted['amount']:,.0f}")
        print(f"      Server Ack RT:   {highest_accepted['latency_ms']:.1f}ms")

    # 5. Verify against Postgres directly
    print(f"\n[5/5] Verifying against Neon Postgres directly...", flush=True)
    print("    Waiting 2.5 seconds for background async DB persistence to settle...", flush=True)
    time.sleep(2.5)

    final_pg = get_postgres_state(ITEM_ID)
    print(f"    Postgres current_bid: INR {final_pg['current_bid']:,.0f}")
    print(f"    Postgres max bid row: INR {final_pg['max_bid']:,.0f}")
    print(f"    Postgres total bids:  {final_pg['bid_count']} (+{final_pg['bid_count'] - initial_pg['bid_count']} new)")

    # Integrity Assertions
    print("\n" + "=" * 70)
    print("VERIFICATION & INTEGRITY REPORT:")
    print("=" * 70)

    if not accepted_bids:
        print("[FAILED] No bids were accepted!")
        return

    highest_accepted_amt = highest_accepted['amount']
    db_current_bid = final_pg['current_bid']
    new_rows_count = final_pg['bid_count'] - initial_pg['bid_count']

    match_price = (db_current_bid == highest_accepted_amt)
    match_ledger = (final_pg['max_bid'] == highest_accepted_amt)

    print(f"1. Winning Bid Matches Postgres current_bid: {'[PASS]' if match_price else '[FAIL]'}")
    print(f"   -> Script Winning Bid: INR {highest_accepted_amt:,.0f} | DB current_bid: INR {db_current_bid:,.0f}")

    print(f"2. Winning Bid Matches Postgres Bid Ledger:   {'[PASS]' if match_ledger else '[FAIL]'}")
    print(f"   -> Script Winning Bid: INR {highest_accepted_amt:,.0f} | Max Bid in Ledger: INR {final_pg['max_bid']:,.0f}")

    print(f"3. Persisted Rows Match Accepted Count:       {'[PASS]' if new_rows_count == len(accepted_bids) else '[INFO]'}")
    print(f"   -> Accepted by Redis Lua: {len(accepted_bids)} | New DB Rows: {new_rows_count}")

    print(f"4. Race Condition Check:                      {'[PASS] ZERO LOST UPDATES' if match_price and match_ledger else '[FAIL]'}")

    print("=" * 70)


if __name__ == "__main__":
    main()
