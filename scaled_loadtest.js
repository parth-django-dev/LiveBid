import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Load pre-seeded auctions and sessions
const config = JSON.parse(open('./loadtest_config.json'));
const auctions = config.auctions;
const sessions = config.sessions;
const users = config.users;

// Target endpoints
const REST_URL = __ENV.REST_URL || 'http://127.0.0.1:8000';
const WS_BASE_URL = __ENV.WS_BASE_URL || 'ws://127.0.0.1:8000';
const TARGET_VUS = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS) : 100;
const DURATION = __ENV.DURATION || '30s';
const FORCE_AUCTION_ID = (__ENV.AUCTION_ID || __ENV.SINGLE_AUCTION) ? parseInt(__ENV.AUCTION_ID || __ENV.SINGLE_AUCTION) : null;

function parseDurationMs(durStr) {
  if (!durStr) return 30000;
  const num = parseInt(durStr, 10);
  if (durStr.endsWith('m')) return num * 60 * 1000;
  if (durStr.endsWith('s')) return num * 1000;
  return num * 1000;
}
const durationMs = parseDurationMs(DURATION);

// Custom Metrics
const bidToBroadcastLatency = new Trend('bid_to_broadcast_ms', true);

const bidsSent = new Counter('bids_sent');
const bidsConfirmed = new Counter('bids_confirmed');
const bidsRejected = new Counter('bids_rejected');
const bidsTimeout = new Counter('bids_timeout');
const bidsAborted = new Counter('bids_aborted');
const bidsUnmatched = new Counter('bids_unmatched');
const bidsSkippedInflight = new Counter('bids_skipped_inflight');
const bidsSkippedSelf = new Counter('bids_skipped_self');

const wsConnectOk = new Counter('ws_connect_ok');
const wsConnectFail = new Counter('ws_connect_fail');
const wsErrors = new Counter('ws_errors');
const wsDisconnects = new Counter('ws_disconnects');
const vuReceivedUpdate = new Counter('vu_received_update');

// Thresholds & Tagged Submetrics
const thresholds = {
  'bid_to_broadcast_ms': ['p(95)<500'],
  'bids_rejected{reason:min_increment}': [],
  'bids_rejected{reason:bid_too_low}': [],
  'bids_rejected{reason:already_highest}': [],
  'bids_rejected{reason:already_ended}': [],
  'bids_rejected{reason:other}': [],
};

// Tagged submetrics for per-auction confirmed counts
for (let a = 1; a <= 20; a++) {
  thresholds[`bids_confirmed{auction:${a}}`] = [];
}

// Tagged submetrics for per-VU tracking (up to max VUs)
const maxVusTracked = Math.max(TARGET_VUS, 100);
for (let v = 1; v <= maxVusTracked; v++) {
  thresholds[`ws_connect_ok{vuid:${v}}`] = [];
  thresholds[`ws_connect_fail{vuid:${v}}`] = [];
  thresholds[`bids_sent{vuid:${v}}`] = [];
  thresholds[`bids_confirmed{vuid:${v}}`] = [];
  thresholds[`vu_received_update{vuid:${v}}`] = [];
}

export const options = {
  setupTimeout: '30s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    livebid_loadtest: {
      executor: 'constant-vus',
      vus: TARGET_VUS,
      duration: DURATION,
      gracefulStop: '5s',
    },
  },
  thresholds: thresholds,
};

function parsePriceFromError(msg) {
  if (!msg) return 0;
  const matches = [...msg.matchAll(/[₹\u20b9]\s*([0-9,]+)/g)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1][1];
    const val = parseFloat(lastMatch.replace(/,/g, ''));
    return isNaN(val) ? 0 : val;
  }
  return 0;
}

export function setup() {
  console.log(`======================================================================`);
  console.log(`Starting LiveBid Load Test: Target ${TARGET_VUS} VUs, Duration ${DURATION}`);
  console.log(`Force Auction ID: ${FORCE_AUCTION_ID || 'Distributed across 20 rooms'}`);
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
  // Select auction: either forced single room or distributed across 20 rooms
  const auctionIndex = FORCE_AUCTION_ID ? (FORCE_AUCTION_ID - 1) : ((__VU - 1) % auctions.length);
  const auction = auctions[auctionIndex];

  // Dedicated authenticated user session per VU
  const userIndex = (__VU - 1) % sessions.length;
  const sessionId = sessions[userIndex];
  const user = users[userIndex];

  // 1. HTTP GET /api/auction/<id>/ to seed initial price & highest bidder before opening socket
  let currentPrice = auction.start_price;
  let highestBidder = null;

  try {
    const res = http.get(`${REST_URL}/api/auction/${auction.id}/`, {
      headers: {
        'Origin': 'http://localhost:5173',
        'User-Agent': `k6-scale/1.0 (VU ${__VU})`,
      },
      tags: { name: 'seed_auction_price' },
    });
    if (res.status === 200) {
      const itemData = res.json();
      currentPrice = parseFloat(itemData.current_bid || itemData.start_price || auction.start_price);
      highestBidder = itemData.highest_bidder || null;
    }
  } catch (e) {
    console.log(`[VU ${__VU}] Error seeding price for auction ${auction.id}: ${e}`);
  }

  const url = `${WS_BASE_URL}/ws/auction/${auction.id}/`;
  const params = {
    headers: {
      'Origin': 'http://localhost:5173',
      'User-Agent': `k6-scale/1.0 (VU ${__VU})`,
      'Cookie': `sessionid=${sessionId}`,
    },
  };

  let inflight = null;
  let intervalId = null;

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      wsConnectOk.add(1, { vuid: String(__VU) });

      // Send initial heartbeat ping
      socket.send(JSON.stringify({ type: 'ping' }));

      // Periodic competitive bidding: every 1.5 seconds
      intervalId = socket.setInterval(() => {
        // Check timeout (5s)
        if (inflight && (Date.now() - inflight.t0 >= 5000)) {
          bidsTimeout.add(1);
          inflight = null;
        }

        // (a) Skip if a bid is currently in flight
        if (inflight !== null) {
          bidsSkippedInflight.add(1);
          return;
        }

        // (b) Skip if I am already the highest bidder
        if (highestBidder === user.username) {
          bidsSkippedSelf.add(1);
          return;
        }

        // amount = price + 500 + random(0..3)*100
        const randomExtra = Math.floor(Math.random() * 4) * 100;
        const amount = currentPrice + 500 + randomExtra;

        const myT0 = Date.now();
        inflight = { amount: amount, t0: myT0 };
        bidsSent.add(1, { vuid: String(__VU) });

        socket.send(JSON.stringify({
          type: 'bid',
          amount: amount,
        }));

        // Safety timeout trigger after 5 seconds
        socket.setTimeout(() => {
          if (inflight && inflight.t0 === myT0) {
            bidsTimeout.add(1);
            inflight = null;
          }
        }, 5000);
      }, 1500);

      // Stop bidding 3.5s before test duration ends so inflight bids can resolve cleanly
      socket.setTimeout(() => {
        if (intervalId) {
          socket.clearInterval(intervalId);
          intervalId = null;
        }
      }, Math.max(1000, durationMs - 3500));

      // Close the socket cleanly right at test duration
      socket.setTimeout(() => {
        if (intervalId) {
          socket.clearInterval(intervalId);
          intervalId = null;
        }
        if (inflight) {
          bidsAborted.add(1);
          inflight = null;
        }
        socket.close();
      }, durationMs);
    });

    socket.on('message', (msg) => {
      try {
        const payload = JSON.parse(msg);

        // Pong heartbeat
        if (payload.type === 'pong') {
          return;
        }

        // Broadcast or direct bid update
        if (payload.type === 'bid_update') {
          vuReceivedUpdate.add(1, { vuid: String(__VU) });

          const updateAmt = parseFloat(payload.amount);
          if (!isNaN(updateAmt) && updateAmt > currentPrice) {
            currentPrice = updateAmt;
          }
          highestBidder = payload.highest_bidder || payload.user || null;

          // If bid belongs to this user
          if (payload.user === user.username) {
            if (inflight && Math.abs(updateAmt - inflight.amount) < 0.01) {
              const latency = Date.now() - inflight.t0;
              bidToBroadcastLatency.add(latency);
              bidsConfirmed.add(1, { auction: String(auction.id), vuid: String(__VU) });
              console.log(`CONFIRMED vu=${__VU} auction=${auction.id} user=${user.username} amount=${updateAmt} ts=${new Date().toISOString()}`);
              inflight = null;
            } else {
              bidsUnmatched.add(1);
              console.log(`[UNMATCHED] VU ${__VU}: type=bid_update for me, amount=${payload.amount}, inflight=${inflight ? inflight.amount : 'none'}`);
            }
          }
        }

        // Error / Rejection response
        else if (payload.type === 'error') {
          const errMsg = payload.message || '';

          // Update live price from error text if higher
          const parsedErrPrice = parsePriceFromError(errMsg);
          if (parsedErrPrice > currentPrice) {
            currentPrice = parsedErrPrice;
          }

          if (errMsg.includes('highest bidder')) {
            highestBidder = user.username;
          }

          if (inflight !== null) {
            let reason = 'other';
            if (errMsg.startsWith('Minimum increment')) {
              reason = 'min_increment';
            } else if (errMsg.startsWith('Bid too low')) {
              reason = 'bid_too_low';
            } else if (errMsg.includes('highest bidder')) {
              reason = 'already_highest';
            } else if (errMsg.includes('already ended')) {
              reason = 'already_ended';
            }
            bidsRejected.add(1, { reason: reason });
            inflight = null;
          } else {
            bidsUnmatched.add(1);
            console.log(`[UNMATCHED] VU ${__VU}: type=error, msg="${errMsg}" (no bid in flight)`);
          }
        }

        // Auction ended event
        else if (payload.type === 'auction_ended') {
          if (payload.winning_bid) {
            currentPrice = parseFloat(payload.winning_bid);
          }
          highestBidder = payload.winner || highestBidder;
        }
      } catch (e) {
        console.log(`[VU ${__VU}] Error parsing message: ${e}`);
      }
    });

    socket.on('error', (e) => {
      wsErrors.add(1);
    });

    socket.on('close', () => {
      wsDisconnects.add(1);
      if (intervalId) {
        socket.clearInterval(intervalId);
        intervalId = null;
      }
      if (inflight) {
        bidsAborted.add(1);
        inflight = null;
      }
    });
  });

  if (!res || res.status !== 101) {
    wsConnectFail.add(1, { vuid: String(__VU) });
  }

  check(res, {
    'WebSocket handshake 101': (r) => r && r.status === 101,
  });

  sleep(0.5);
}

export function handleSummary(data) {
  function getCount(metricName) {
    return data.metrics[metricName] && data.metrics[metricName].values
      ? (data.metrics[metricName].values.count || 0)
      : 0;
  }

  const sent = getCount('bids_sent');
  const confirmed = getCount('bids_confirmed');
  const timeout = getCount('bids_timeout');
  const aborted = getCount('bids_aborted');
  const unmatched = getCount('bids_unmatched');
  const skippedInflight = getCount('bids_skipped_inflight');
  const skippedSelf = getCount('bids_skipped_self');

  const rejMinInc = getCount('bids_rejected{reason:min_increment}');
  const rejTooLow = getCount('bids_rejected{reason:bid_too_low}');
  const rejHighest = getCount('bids_rejected{reason:already_highest}');
  const rejEnded = getCount('bids_rejected{reason:already_ended}');
  const rejOther = getCount('bids_rejected{reason:other}');
  const rejectedTotal = getCount('bids_rejected');

  const wsOk = getCount('ws_connect_ok');
  const wsFail = getCount('ws_connect_fail');
  const wsErr = getCount('ws_errors');
  const wsDisc = getCount('ws_disconnects');

  const latencyMetric = data.metrics['bid_to_broadcast_ms'];
  const latValues = latencyMetric && latencyMetric.values ? latencyMetric.values : {};
  const p50 = latValues['p(50)'] || latValues['med'] || 0;
  const p95 = latValues['p(95)'] || 0;
  const p99 = latValues['p(99)'] || 0;
  const sampleCount = (latValues['count'] !== undefined && latValues['count'] > 0) ? latValues['count'] : confirmed;

  const resolved = confirmed + rejectedTotal + timeout + aborted;
  const diff = sent - resolved;
  const accountingPass = (sent === resolved);

  // Per-auction accepted counts
  const perAuction = {};
  for (let a = 1; a <= 20; a++) {
    perAuction[a] = getCount(`bids_confirmed{auction:${a}}`);
  }

  // Per-VU breakdown
  const perVu = [];
  const totalVUs = (data.metrics.vus && data.metrics.vus.values.max) ? data.metrics.vus.values.max : TARGET_VUS;
  for (let v = 1; v <= totalVUs; v++) {
    const ok = getCount(`ws_connect_ok{vuid:${v}}`);
    const fail = getCount(`ws_connect_fail{vuid:${v}}`);
    let connStatus = 'NO';
    if (ok > 0 && fail === 0) {
      connStatus = 'YES';
    } else if (ok > 0 && fail > 0) {
      connStatus = `YES (${fail}f)`;
    } else if (fail > 0) {
      connStatus = `FAIL (${fail})`;
    }
    const vSent = getCount(`bids_sent{vuid:${v}}`);
    const vConf = getCount(`bids_confirmed{vuid:${v}}`);
    const vRecv = getCount(`vu_received_update{vuid:${v}}`);
    perVu.push({ vu: v, connected: connStatus, bids_sent: vSent, bids_confirmed: vConf, updates_received: vRecv });
  }

  // Format Console Summary
  let summaryText = `\n======================================================================\n`;
  summaryText += `LIVEBID LOAD TEST ACCOUNTING & PERFORMANCE SUMMARY\n`;
  summaryText += `======================================================================\n`;
  summaryText += `Target VUs: ${totalVUs} | Duration: ${DURATION}\n`;
  summaryText += `WebSocket Connections: OK=${wsOk}, Fail=${wsFail}, Errors=${wsErr}, Disconnects=${wsDisc}\n`;
  summaryText += `----------------------------------------------------------------------\n`;
  summaryText += `Bids Sent:               ${sent}\n`;
  summaryText += `Bids Confirmed:          ${confirmed}\n`;
  summaryText += `Bids Rejected Total:     ${rejectedTotal}\n`;
  summaryText += `  - Min Increment:       ${rejMinInc}\n`;
  summaryText += `  - Bid Too Low:         ${rejTooLow}\n`;
  summaryText += `  - Already Highest:     ${rejHighest}\n`;
  summaryText += `  - Already Ended:       ${rejEnded}\n`;
  summaryText += `  - Other:               ${rejOther}\n`;
  summaryText += `Bids Timed Out (5s):     ${timeout}\n`;
  summaryText += `Bids Aborted (at close): ${aborted}\n`;
  summaryText += `Bids Unmatched:          ${unmatched}\n`;
  summaryText += `Bids Skipped (Inflight): ${skippedInflight}\n`;
  summaryText += `Bids Skipped (Self):     ${skippedSelf}\n`;
  summaryText += `----------------------------------------------------------------------\n`;
  summaryText += `ACCOUNTING CHECK: sent == confirmed + rejected + timeout + aborted\n`;
  summaryText += `  ${sent} == ${confirmed} + ${rejectedTotal} + ${timeout} + ${aborted} (resolved: ${resolved})\n`;
  summaryText += `  Result: ${accountingPass ? 'PASS' : 'FAIL'} (Difference: ${diff})\n`;
  summaryText += `----------------------------------------------------------------------\n`;
  summaryText += `LATENCY (bid_to_broadcast_ms):\n`;
  summaryText += `  Sample Count: ${sampleCount}\n`;
  summaryText += `  p50: ${p50.toFixed(1)} ms\n`;
  summaryText += `  p95: ${p95.toFixed(1)} ms\n`;
  summaryText += `  p99: ${p99.toFixed(1)} ms\n`;
  summaryText += `----------------------------------------------------------------------\n`;
  summaryText += `PER-AUCTION ACCEPTED BIDS:\n`;
  for (let a = 1; a <= 20; a++) {
    summaryText += `  Auction #${String(a).padStart(2, '0')}: ${perAuction[a]} confirmed\n`;
  }
  summaryText += `----------------------------------------------------------------------\n`;
  summaryText += `PER-VU BREAKDOWN:\n`;
  summaryText += `VU   | Connected? | Bids Sent | Bids Confirmed | Recv Updates\n`;
  summaryText += `-----+------------+-----------+----------------+-------------\n`;
  for (const v of perVu) {
    summaryText += `${String(v.vu).padEnd(4)} | ${String(v.connected).padEnd(10)} | ${String(v.bids_sent).padEnd(9)} | ${String(v.bids_confirmed).padEnd(14)} | ${v.updates_received}\n`;
  }
  summaryText += `======================================================================\n`;

  console.log(summaryText);

  const jsonReport = {
    target_vus: totalVUs,
    duration: DURATION,
    accounting: {
      sent: sent,
      confirmed: confirmed,
      rejected_total: rejectedTotal,
      rejected_by_reason: {
        min_increment: rejMinInc,
        bid_too_low: rejTooLow,
        already_highest: rejHighest,
        already_ended: rejEnded,
        other: rejOther,
      },
      timeout: timeout,
      aborted: aborted,
      resolved: resolved,
      diff: diff,
      pass: accountingPass,
    },
    unmatched: unmatched,
    skipped: {
      inflight: skippedInflight,
      self: skippedSelf,
    },
    websocket: {
      connect_ok: wsOk,
      connect_fail: wsFail,
      errors: wsErr,
      disconnects: wsDisc,
    },
    latency_ms: {
      sample_count: sampleCount,
      p50: p50,
      p95: p95,
      p99: p99,
    },
    per_auction: perAuction,
    per_vu: perVu,
  };

  return {
    'summary.json': JSON.stringify(jsonReport, null, 2),
    stdout: summaryText,
  };
}
