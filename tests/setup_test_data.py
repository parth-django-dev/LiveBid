import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import redis
from concurrency_test import get_db_connection

REDIS_URL = os.getenv("REDIS_URL", "rediss://default:gQAAAAAAAsltAAIgcDI2MzQyYzFiYjA4Yjk0MjhkYmIxY2M5MWE0ZGJmNTUyMQ@elegant-beetle-182637.upstash.io:6379")

def setup():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Get user IDs
        cur.execute("SELECT id, username FROM auth_user WHERE username in ('Parth', 'Aryan', 'bidder_25', 'bidder_18');")
        users = dict(cur.fetchall())
        user_ids = {u: uid for uid, u in users.items()}

        parth_id = user_ids.get('Parth', 2)
        bidder_25_id = user_ids.get('bidder_25')

        # 1. Setup Item 17 ("Working"): current_bid=26000, leader=Parth, active
        cur.execute("""
            UPDATE auctions_auctionitem 
            SET current_bid = 26000.00, is_active = True, end_time = NOW() + INTERVAL '1 day'
            WHERE id = 17;
        """)
        cur.execute("""
            DELETE FROM auctions_bid 
            WHERE item_id = 17 AND user_id != %s;
        """, (parth_id,))

        # 2. Setup Item 15 ("Casio"): seller = bidder_25
        if bidder_25_id:
            cur.execute("""
                UPDATE auctions_auctionitem 
                SET seller_id = %s, is_active = True, end_time = NOW() + INTERVAL '1 day'
                WHERE id = 15;
            """, (bidder_25_id,))

        # 3. Setup Item 14 ("Lugia"): end_time = NOW() + 35s (anti-snipe test)
        cur.execute("""
            UPDATE auctions_auctionitem 
            SET is_active = True, end_time = NOW() + INTERVAL '35 seconds'
            WHERE id = 14;
        """)

        conn.commit()

        # Sync Upstash Redis keys
        try:
            r = redis.from_url(REDIS_URL)
            r.set("auction:17:highest_bid", "26000")
            r.set("auction:17:highest_bidder", "Parth")
            r.set("auction:14:highest_bidder", "bidder_18")
            # Invalidate cached REST data
            r.delete("auction_details_17", "auction_details_15", "auction_details_14", "active_auctions_list")
            print("Redis state synchronized for Items 14, 15, 17.")
        except Exception as re:
            print("Redis sync warning:", re)

        print("Test data setup complete: Item 15 seller=bidder_25, Item 17 leader=Parth.")
    finally:
        cur.close()
        conn.close()

def set_anti_snipe_window(item_id=14, seconds=45):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM auth_user WHERE username = 'bidder_18';")
        bidder_18_id = cur.fetchone()[0]

        cur.execute(f"""
            UPDATE auctions_auctionitem 
            SET is_active = True, winner_id = NULL, current_bid = 100000.00, end_time = NOW() + INTERVAL '{seconds} seconds'
            WHERE id = %s;
        """, (item_id,))

        # Delete any previous bids by bidder_4 so bidder_4 can bid cleanly
        cur.execute("SELECT id FROM auth_user WHERE username = 'bidder_4';")
        b4_row = cur.fetchone()
        if b4_row:
            cur.execute("DELETE FROM auctions_bid WHERE item_id = %s AND user_id = %s;", (item_id, b4_row[0]))

        # Ensure bidder_18 is the highest bidder in DB
        cur.execute("""
            INSERT INTO auctions_bid (item_id, user_id, amount, bid_time)
            VALUES (%s, %s, 100000.00, NOW());
        """, (item_id, bidder_18_id))

        conn.commit()

        try:
            r = redis.from_url(REDIS_URL)
            r.set(f"auction:{item_id}:highest_bid", "100000")
            r.set(f"auction:{item_id}:highest_bidder", "bidder_18")
            r.delete(f"auction_details_{item_id}", "active_auctions_list")
        except Exception as re:
            print("Redis sync warning:", re)

        print(f"Item {item_id} set to {seconds}s anti-snipe window with bidder_18 as leader.")
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    if '--anti-snipe' in sys.argv:
        set_anti_snipe_window(14, 45)
    else:
        setup()
