// bidLogic.test.js
const { evaluateBid, MockRedis, LUA_ATOMIC_BID } = require('./bidLogic'); // wrap your Lua call in a testable function

describe('Atomic bidding logic', () => {
  test('rejects bid below minimum increment', async () => {
    const result = await evaluateBid({ currentBid: 1000, amount: 1020, minStep: 50 });
    expect(result.accepted).toBe(false);
  });

  test('accepts valid bid above minimum increment', async () => {
    const result = await evaluateBid({ currentBid: 1000, amount: 1100, minStep: 50 });
    expect(result.accepted).toBe(true);
  });

  test('rejects self-outbid', async () => {
    const result = await evaluateBid({ currentBid: 1000, currentBidder: 'alice', user: 'alice', amount: 1100 });
    expect(result.accepted).toBe(false);
  });

  test('rejects seller bidding on own item', async () => {
    const result = await evaluateBid({ seller: 'bob', user: 'bob', amount: 1100 });
    expect(result.accepted).toBe(false);
  });

  test('accepts first bid when no previous bid exists in Redis', async () => {
    const result = await evaluateBid({ user: 'charlie', amount: 500, minStep: 50 });
    expect(result.accepted).toBe(true);
    expect(result.newBid).toBe(500);
    expect(result.newBidder).toBe('charlie');
  });

  test('rejects bid equal to current bid', async () => {
    const result = await evaluateBid({ currentBid: 1000, amount: 1000, minStep: 0 });
    expect(result.accepted).toBe(false);
  });

  test('updates mock Redis state atomically when bid is accepted', async () => {
    const redis = new MockRedis({
      'auction:1:highest_bid': '1000',
      'auction:1:highest_bidder': 'alice',
    });

    const result = await evaluateBid({
      itemId: 1,
      currentBid: 1000,
      currentBidder: 'alice',
      user: 'bob',
      amount: 1200,
      minStep: 100,
      redis,
    });

    expect(result.accepted).toBe(true);
    expect(await redis.get('auction:1:highest_bid')).toBe('1200');
    expect(await redis.get('auction:1:highest_bidder')).toBe('bob');
  });
});
