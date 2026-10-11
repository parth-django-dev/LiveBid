/**
 * bidLogic.js
 * 
 * Encapsulates the atomic bidding validation and Lua script logic
 * matching the Django Channels / Redis implementation in AuctionConsumer.
 */

// The exact Lua script executed atomically in Redis
const LUA_ATOMIC_BID = `
local current_bidder = redis.call('GET', KEYS[2])
local user = ARGV[2]

if current_bidder and current_bidder == user then
    return -1
end

local current = redis.call('GET', KEYS[1])
local new_val = tonumber(ARGV[1])

if not current then
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SET', KEYS[2], user)
    return 1
end

if new_val > tonumber(current) then
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SET', KEYS[2], user)
    return 1
else
    return 0
end
`;

/**
 * Calculates dynamic minimum increment step based on current price.
 * Matches backend get_minimum_step logic.
 */
function getMinimumStep(currentPrice) {
  const price = Number(currentPrice || 0);
  if (price < 1000) return 50;
  if (price < 10000) return 100;
  if (price < 100000) return 500;
  if (price < 1000000) return 5000;
  if (price < 10000000) return 25000;
  return 100000;
}

/**
 * In-memory Mock Redis client providing get, set, and eval
 * for isolated, fast unit testing without requiring a live Redis server.
 */
class MockRedis {
  constructor(initialState = {}) {
    this.store = new Map(Object.entries(initialState));
  }

  async get(key) {
    const val = this.store.get(key);
    return val !== undefined ? String(val) : null;
  }

  async set(key, value) {
    this.store.set(key, String(value));
    return 'OK';
  }

  /**
   * Executes the Lua atomic bidding logic in-memory.
   * Mirrors Redis EVAL for LUA_ATOMIC_BID.
   */
  async eval(script, numKeys, key1, key2, arg1, arg2) {
    const currentBidder = this.store.get(key2);
    const user = String(arg2);

    // Rule 1: Reject self-outbid
    if (currentBidder && currentBidder === user) {
      return -1;
    }

    const current = this.store.get(key1);
    const newVal = Number(arg1);

    // First bid on item
    if (current === undefined || current === null) {
      this.store.set(key1, String(arg1));
      this.store.set(key2, user);
      return 1;
    }

    // Must be strictly greater than current highest bid
    if (newVal > Number(current)) {
      this.store.set(key1, String(arg1));
      this.store.set(key2, user);
      return 1;
    } else {
      return 0;
    }
  }
}

/**
 * Evaluates a bid against auction business rules and atomic Lua script logic.
 *
 * @param {Object} params
 * @param {number|string} [params.itemId=1] - Auction item ID
 * @param {number} [params.currentBid] - Current highest bid in auction
 * @param {string} [params.currentBidder] - Current leading bidder username
 * @param {string} [params.seller] - Seller username (for shill prevention)
 * @param {string} [params.user='bidder'] - User placing the bid
 * @param {number} params.amount - Proposed bid amount
 * @param {number} [params.minStep] - Minimum increment step override
 * @param {MockRedis|Object} [params.redis] - Injected Redis client
 * @returns {Promise<{ accepted: boolean, reason?: string, message?: string, newBid?: number, newBidder?: string }>}
 */
async function evaluateBid({
  itemId = 1,
  currentBid,
  currentBidder,
  seller,
  user = 'bidder',
  amount,
  minStep,
  redis,
} = {}) {
  // 1. Shill Bidding Prevention: Seller cannot bid on own listing
  if (seller && user && seller === user) {
    return {
      accepted: false,
      reason: 'seller_cannot_bid',
      message: 'You are the seller of this auction and cannot bid on your own listing.',
    };
  }

  // 2. Minimum Increment Validation
  const currentHighest = currentBid !== undefined && currentBid !== null ? Number(currentBid) : 0;
  const step = minStep !== undefined ? Number(minStep) : getMinimumStep(currentHighest);

  if (amount < currentHighest + step) {
    return {
      accepted: false,
      reason: 'below_minimum_increment',
      message: `Minimum increment is ₹${step}. Bid must be at least ₹${currentHighest + step}.`,
    };
  }

  // 3. Prepare Redis Keys & Client
  const bidKey = `auction:${itemId}:highest_bid`;
  const bidderKey = `auction:${itemId}:highest_bidder`;

  const client = redis || new MockRedis({
    ...(currentBid !== undefined && currentBid !== null ? { [bidKey]: String(currentBid) } : {}),
    ...(currentBidder ? { [bidderKey]: String(currentBidder) } : {}),
  });

  // 4. Atomic Redis Lua evaluation
  const luaResult = await client.eval(
    LUA_ATOMIC_BID,
    2,
    bidKey,
    bidderKey,
    String(amount),
    String(user)
  );

  if (luaResult === -1) {
    return {
      accepted: false,
      reason: 'self_outbid',
      message: 'You are currently the highest bidder. You cannot outbid yourself!',
    };
  }

  if (luaResult === 1) {
    return {
      accepted: true,
      newBid: Number(amount),
      newBidder: user,
      message: 'Bid placed successfully!',
    };
  }

  return {
    accepted: false,
    reason: 'outbid',
    message: 'Your bid was not higher than the current highest bid.',
  };
}

module.exports = {
  LUA_ATOMIC_BID,
  MockRedis,
  getMinimumStep,
  evaluateBid,
};
