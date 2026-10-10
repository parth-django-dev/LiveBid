import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Target endpoints
const REST_URL = 'https://live-bid-seven.vercel.app';
const WS_BASE_URL = 'wss://livebid-ti6v.onrender.com';
const ITEM_ID = 11;

// Custom Metrics
const wsConnectDuration = new Trend('ws_connect_duration');
const wsPingDuration = new Trend('ws_ping_roundtrip');
const wsBidDuration = new Trend('ws_bid_roundtrip');
const bidsAccepted = new Counter('ws_bids_accepted');
const bidsProcessed = new Counter('ws_bids_processed');

export const options = {
  setupTimeout: '60s',
  scenarios: {
    // 10 concurrent REST catalog viewers
    rest_catalog: {
      executor: 'constant-vus',
      exec: 'browseCatalog',
      vus: 10,
      duration: '35s',
    },
    // Ramps to 20 concurrent WebSocket bidders -> Peak total = 30 VUs
    live_bidding: {
      executor: 'ramping-vus',
      exec: 'placeBids',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 }, // ramp to 20 live bidders (total 30 VUs)
        { duration: '20s', target: 20 }, // sustain 20 live bidders (total 30 VUs)
        { duration: '5s', target: 0 },   // ramp down
      ],
    },
  },
  thresholds: {
    'checks': ['rate>0.90'],
    // Separate thresholds to isolate which REST endpoint causes the latency tail
    'http_req_duration{name:active_auctions}': ['p(95)<12000'],
    'http_req_duration{name:auction_details}': ['p(95)<12000'],
    'ws_connect_duration': ['p(95)<3500'],
    'ws_ping_roundtrip': ['p(95)<1500'],
  },
};

/**
 * setup() runs once before VUs spawn.
 * 1. Discovers current auction price dynamically.
 * 2. Pre-authenticates 5 test bidder accounts so VUs do not overload the server with PBKDF2 hashing.
 */
export function setup() {
  console.log('--- Initializing k6 Test Environment (30 VUs Target) ---');
  let baseBid = 85000;
  let minStep = 500;

  // 1. Fetch live auction price
  try {
    const itemRes = http.get(`${REST_URL}/api/auction/${ITEM_ID}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      tags: { name: 'setup_auction_discovery' },
    });
    if (itemRes.status === 200) {
      const data = itemRes.json();
      baseBid = data.current_bid || data.start_price || 85000;
      minStep = data.min_step || 500;
      console.log(`Discovered Auction #${ITEM_ID}: Current Price = ₹${baseBid}, Min Step = ₹${minStep}`);
    }
  } catch (e) {
    console.log('Error fetching auction item:', e);
  }

  // 2. Authenticate test users pool
  const testUsers = ['bidder_alpha', 'bidder_beta', 'bidder_gamma', 'bidder_delta', 'bidder_epsilon'];
  const sessions = [];

  for (const username of testUsers) {
    const loginPayload = JSON.stringify({
      username: username,
      password: 'Password123!',
    });

    let res = http.post(`${REST_URL}/api/login/`, loginPayload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      tags: { name: 'setup_auth' },
    });

    let sid = res.cookies && res.cookies.sessionid ? res.cookies.sessionid[0].value : null;

    if (!sid) {
      // Register fallback if user not yet created
      res = http.post(
        `${REST_URL}/api/register/`,
        JSON.stringify({
          username: username,
          email: `${username}@test.com`,
          password: 'Password123!',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          tags: { name: 'setup_auth' },
        }
      );
      sid = res.cookies && res.cookies.sessionid ? res.cookies.sessionid[0].value : null;
    }

    if (sid) {
      sessions.push(sid);
    }
  }

  console.log(`Pre-authentication complete: ${sessions.length} sessions active for test.`);

  return {
    itemId: ITEM_ID,
    baseBid: baseBid,
    minStep: minStep,
    sessions: sessions,
  };
}

// Scenario 1: REST traffic with individually-tagged requests to isolate endpoint tails
export function browseCatalog(data) {
  // Request A: Active auctions catalog
  const resActive = http.get(`${REST_URL}/api/active-auctions/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    tags: { name: 'active_auctions' },
  });
  check(resActive, {
    'active_auctions status is 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // Request B: Specific auction room details & bid history
  const resDetail = http.get(`${REST_URL}/api/auction/${data.itemId}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    tags: { name: 'auction_details' },
  });
  check(resDetail, {
    'auction_details status is 200': (r) => r.status === 200,
  });

  sleep(1);
}

// Scenario 2: Real-time WebSocket bidding: Direct to Render Daphne ASGI
export function placeBids(data) {
  const vuIndex = (__VU - 1) % (data.sessions.length > 0 ? data.sessions.length : 1);
  const sessionId = data.sessions && data.sessions.length > 0 ? data.sessions[vuIndex] : null;

  const params = {
    headers: {
      'Origin': 'https://live-bid-seven.vercel.app',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  };
  if (sessionId) {
    params.headers['Cookie'] = `sessionid=${sessionId}`;
  }

  const url = `${WS_BASE_URL}/ws/auction/${data.itemId}/`;
  const connectStart = Date.now();

  const res = ws.connect(url, params, function (socket) {
    let pingSent = 0;
    let bidSent = 0;

    socket.on('open', () => {
      wsConnectDuration.add(Date.now() - connectStart);

      // Send WebSocket heartbeat ping
      pingSent = Date.now();
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (msg) => {
      check(msg, { 'received WS frame': (m) => m && m.length > 0 });

      try {
        const payload = JSON.parse(msg);

        // Heartbeat pong received -> now send competitive bid
        if (payload.type === 'pong') {
          if (pingSent > 0) {
            wsPingDuration.add(Date.now() - pingSent);
            pingSent = 0;
          }

          bidSent = Date.now();
          const bidAmount = data.baseBid + 1000 + (__ITER * 1000) + ((__VU % 5) * 500);
          socket.send(JSON.stringify({ type: 'bid', amount: bidAmount }));
        }

        // Winning bid accepted
        else if (payload.type === 'bid_update') {
          if (bidSent > 0) {
            wsBidDuration.add(Date.now() - bidSent);
            bidSent = 0;
          }
          bidsAccepted.add(1);
        }

        // Server processed bid (outbid, leader, or min step)
        else if (payload.type === 'error') {
          if (bidSent > 0) {
            wsBidDuration.add(Date.now() - bidSent);
            bidSent = 0;
          }
          bidsProcessed.add(1);
        }
      } catch (e) {
      }
    });

    socket.on('error', (e) => {
      console.log('WS error:', e.error());
    });

    // Cleanly close connection after 2.5 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 2500);
  });

  check(res, {
    'WS connected (101)': (r) => r && r.status === 101,
  });

  sleep(0.5);
}