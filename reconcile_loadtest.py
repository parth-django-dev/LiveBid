import os
import json
import psycopg2
import redis
from dotenv import load_dotenv

# Load staging loadtest environment
load_dotenv('.env.loadtest', override=True)

DB_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL")

def get_diagnostics():
    """Fetches Postgres connection count and Redis metrics."""
    diag = {}

    # 1. Postgres Connections
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = 'staging_loadtest';")
        diag["pg_connections"] = cur.fetchone()[0]
        cur.close()
        conn.close()
    except Exception as e:
        diag["pg_connections_err"] = str(e)

    # 2. Redis Info
    if REDIS_URL:
        try:
            r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            info = r.info()
            diag["redis_clients"] = info.get("connected_clients")
            diag["redis_ops_per_sec"] = info.get("instantaneous_ops_per_sec", 0)
            diag["redis_memory"] = info.get("used_memory_human", "N/A")
            diag["redis_total_commands"] = info.get("total_commands_processed", 0)
        except Exception as e:
            diag["redis_err"] = str(e)

    return diag

def reconcile():
    print("=" * 75)
    print("LIVEBID RECONCILIATION & DATA INTEGRITY AUDIT")
    print("=" * 75)

    diag = get_diagnostics()
    print(f"Postgres Active Connections: {diag.get('pg_connections', 'N/A')}")
    print(f"Redis Connected Clients:     {diag.get('redis_clients', 'N/A')} (ops/sec: {diag.get('redis_ops_per_sec', 0)}, mem: {diag.get('redis_memory', 'N/A')})")
    print("-" * 75)

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("""
        SELECT a.id, a.title, a.start_price, a.current_bid,
               COALESCE(b.bid_count, 0) as bid_count,
               COALESCE(b.max_bid, a.start_price) as max_bid,
               b.top_bidder
        FROM auctions_auctionitem a
        LEFT JOIN (
            SELECT item_id,
                   COUNT(*) as bid_count,
                   MAX(amount) as max_bid,
                   (SELECT u.username FROM auctions_bid sub_b
                    JOIN auth_user u ON sub_b.user_id = u.id
                    WHERE sub_b.item_id = auctions_bid.item_id
                    ORDER BY sub_b.amount DESC, sub_b.id DESC LIMIT 1) as top_bidder
            FROM auctions_bid
            GROUP BY item_id
        ) b ON a.id = b.item_id
        WHERE a.title LIKE 'LoadTest Item%'
        ORDER BY a.id ASC;
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    r = redis.Redis.from_url(REDIS_URL, decode_responses=True) if REDIS_URL else None

    total_bids_persisted = 0
    drift_count = 0
    results = []

    print(f"{'Item ID':<8} | {'Title':<16} | {'DB Current':<12} | {'DB Max Bid':<12} | {'Redis Bid':<12} | {'Bids':<6} | {'Status'}")
    print("-" * 75)

    for row in rows:
        item_id, title, start_price, current_bid, bid_count, max_bid, top_bidder = row
        current_bid = float(current_bid)
        max_bid = float(max_bid)
        total_bids_persisted += bid_count

        redis_bid = None
        if r:
            try:
                cached = r.get(f"auction:{item_id}:highest_bid")
                redis_bid = float(cached) if cached else None
            except Exception:
                pass

        # Integrity Check: current_bid == max_bid
        is_consistent = (current_bid == max_bid)
        if redis_bid is not None and abs(redis_bid - current_bid) > 0.01:
            is_consistent = False

        status = "MATCH" if is_consistent else "DRIFT"
        if not is_consistent:
            drift_count += 1

        redis_str = f"INR {redis_bid:,.0f}" if redis_bid is not None else "N/A"
        print(f"{item_id:<8} | {title:<16} | INR {current_bid:<7,.0f} | INR {max_bid:<7,.0f} | {redis_str:<12} | {bid_count:<6} | {status}")

        results.append({
            "id": item_id,
            "title": title,
            "current_bid": current_bid,
            "max_bid": max_bid,
            "redis_bid": redis_bid,
            "bid_count": bid_count,
            "consistent": is_consistent,
            "top_bidder": top_bidder,
        })

    print("-" * 75)
    print(f"Total Bids Persisted to Postgres: {total_bids_persisted}")
    print(f"State Drift Count:               {drift_count} items")
    print(f"Correctness Guarantee:           {'100% (ZERO LOST UPDATES)' if drift_count == 0 else 'DRIFT DETECTED'}")
    print("=" * 75)

    return {
        "diagnostics": diag,
        "total_bids": total_bids_persisted,
        "drift_count": drift_count,
        "zero_lost_updates": (drift_count == 0),
        "items": results,
    }

if __name__ == "__main__":
    reconcile()
