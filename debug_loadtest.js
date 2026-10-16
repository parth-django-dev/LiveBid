import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Load pre-seeded auctions and sessions
const config = JSON.parse(open('./loadtest_config.json'));
const auctions = config.auctions;
const sessions = config.sessions;
const users = config.users;

// Target endpoints
const REST_URL = __ENV.REST_URL || 'http://127.0.0.1:8000';
const WS_BASE_URL = __ENV.WS_BASE_URL || 'ws://127.0.0.1:8000';
const TARGET_VUS = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS) : 1;
const DURATION = __ENV.DURATION || '30s';
const FORCE_AUCTION_ID = __ENV.AUCTION_ID ? parseInt(__ENV.AUCTION_ID) : null;

// Custom Metrics
const wsConnectDuration = new Trend('ws_connect_duration', true);
const bidToBroadcastLatency = new Trend('bid_to_broadcast_latency', true);
const bidsAccepted = new Counter('bids_accepted');
const bidsRejectedRace = new Counter('bids_rejected_race');
const bidsUnexpectedErrors = new Counter('bids_unexpected_errors');
const wsConnectionFailures = new Counter('ws_connection_failures');
const wsFramesReceived = new Counter('ws_frames_received');
const successRate = new Rate('bid_success_rate');

export const options = {
  setupTimeout: '30s',
  scenarios: {
    debug_run: {
      executor: 'constant-vus',
      vus: TARGET_VUS,
      duration: DURATION,
      gracefulStop: '5s',
    },
  },
  thresholds: {
    'ws_connection_failures': ['count<50'],
    'bid_to_broadcast_latency': ['p(95)<1500', 'p(99)<3000'],
  },
};

export function setup() {
  console.log(`======================================================================`);
  console.log(`Starting LiveBid Debug Run: Target ${TARGET_VUS} VUs, Duration ${DURATION}`);
  console.log(`Force Auction ID: ${FORCE_AUCTION_ID || 'Distributed'}`);
  console.log(`Endpoints: REST=${REST_URL} | WS=${WS_BASE_URL}`);
  console.log(`======================================================================`);

  const res = http.get(`${REST_URL}/api/auction/${auctions[0].id}/`);
  check(res, {
    'API reachable': (r) => r.status === 200,
  });

  return {
    startTime: Date.now(),
    targetVUs: TARGET_VUS,
  };
}

export default function () {
  // Select auction: either forced or spread across auctions
  const auctionIndex = FORCE_AUCTION_ID ? (FORCE_AUCTION_ID - 1) : ((__VU - 1) % auctions.length);
  const auction = auctions[auctionIndex];

  // Dedicated authenticated user session per VU
  const userIndex = (__VU - 1) % sessions.length;
  const sessionId = sessions[userIndex];
  const user = users[userIndex];

  const url = `${WS_BASE_URL}/ws/auction/${auction.id}/`;
  const params = {
    headers: {
      'Origin': 'http://localhost:5173',
      'User-Agent': `k6-scale/1.0 (VU ${__VU})`,
      'Cookie': `sessionid=${sessionId}`,
    },
  };

  const connectStart = Date.now();

  const res = ws.connect(url, params, function (socket) {
    let bidSentTime = 0;
    let currentAuctionPrice = auction.start_price;
    let bidSeq = 0;

    socket.on('open', () => {
      wsConnectDuration.add(Date.now() - connectStart);

      // Send heartbeat ping first
      const pingPayload = JSON.stringify({ type: 'ping' });
      console.log(`[${new Date().toISOString()}] [VU ${__VU}] [SENT] ${pingPayload}`);
      socket.send(pingPayload);

      // Periodic competitive bidding: every 1.5 seconds per user
      socket.setInterval(() => {
        bidSeq++;
        // Increment competitive bid (identical to scaled_loadtest.js)
        const bidAmount = currentAuctionPrice + 500 + (bidSeq * 500) + ((__VU % 10) * 100);
        bidSentTime = Date.now();

        const bidPayload = JSON.stringify({
          type: 'bid',
          amount: bidAmount,
        });
        console.log(`[${new Date().toISOString()}] [VU ${__VU}] [SENT] ${bidPayload}`);
        socket.send(bidPayload);
      }, 1500);
    });

    socket.on('message', (msg) => {
      console.log(`[${new Date().toISOString()}] [VU ${__VU}] [RECV] ${msg}`);
      wsFramesReceived.add(1);

      try {
        const payload = JSON.parse(msg);

        // Ping response
        if (payload.type === 'pong') {
          return;
        }

        // Winning bid acknowledged
        if (payload.type === 'bid_update') {
          if (payload.user === user.username && bidSentTime > 0) {
            const latency = Date.now() - bidSentTime;
            bidToBroadcastLatency.add(latency);
            bidsAccepted.add(1);
            successRate.add(1);
            bidSentTime = 0;
          }

          if (payload.amount) {
            const parsedAmt = parseFloat(payload.amount);
            if (parsedAmt > currentAuctionPrice) {
              currentAuctionPrice = parsedAmt;
            }
          }
        }

        // Error response (e.g. race rejection or logic error)
        else if (payload.type === 'error') {
          if (bidSentTime > 0) {
            const latency = Date.now() - bidSentTime;
            bidToBroadcastLatency.add(latency);
            bidSentTime = 0;
          }

          const msgText = payload.message || '';
          const isRaceLoss = (
            msgText.includes('Minimum increment') ||
            msgText.includes('Bid too low') ||
            msgText.includes('highest bidder')
          );

          if (isRaceLoss) {
            bidsRejectedRace.add(1);
            successRate.add(1);
          } else {
            bidsUnexpectedErrors.add(1);
            successRate.add(0);
          }
        }
      } catch (e) {
        bidsUnexpectedErrors.add(1);
        successRate.add(0);
      }
    });

    socket.on('error', (e) => {
      console.log(`[${new Date().toISOString()}] [VU ${__VU}] [ERROR] ${e.error()}`);
      wsConnectionFailures.add(1);
    });
  });

  check(res, {
    'WebSocket handshake 101': (r) => r && r.status === 101,
  });

  sleep(1);
}

export function teardown(data) {
  console.log(`Teardown complete for ${data.targetVUs} VUs.`);
}
