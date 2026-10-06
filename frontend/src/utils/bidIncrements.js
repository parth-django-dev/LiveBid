/**
 * Dynamic bid increments and currency formatting utilities.
 */

export function getBidConfig(currentPrice = 0) {
  const price = Number(currentPrice) || 0;

  let minStep = 100;
  let quickIncrements = [100, 250, 500];

  if (price < 1000) {
    minStep = 50;
    quickIncrements = [50, 100, 250];
  } else if (price < 10000) {
    minStep = 100;
    quickIncrements = [250, 500, 1000];
  } else if (price < 100000) {
    minStep = 500;
    quickIncrements = [1000, 2500, 5000];
  } else if (price < 1000000) {
    // 1 Lakh to 10 Lakh
    minStep = 5000;
    quickIncrements = [10000, 25000, 50000];
  } else if (price < 10000000) {
    // 10 Lakh to 1 Crore
    minStep = 25000;
    quickIncrements = [50000, 100000, 250000];
  } else if (price < 50000000) {
    // 1 Crore to 5 Crore (10M - 50M) -> e.g. 25M
    minStep = 100000; // 1 Lakh min step
    quickIncrements = [250000, 500000, 1000000]; // +2.5L, +5L, +10L
  } else {
    // 5 Crore+ (50M+)
    minStep = 500000; // 5 Lakh min step
    quickIncrements = [1000000, 2500000, 5000000]; // +10L, +25L, +50L
  }

  const minNextBid = price + minStep;

  return {
    minStep,
    minNextBid,
    quickIncrements: quickIncrements.map((inc) => ({
      increment: inc,
      targetBid: price + inc,
      label: formatIncrementBadge(inc),
      fullLabel: `+₹${inc.toLocaleString('en-IN')}`,
    })),
  };
}

export function formatIncrementBadge(amount) {
  if (amount >= 10000000) {
    const cr = amount / 10000000;
    return `+₹${parseFloat(cr.toFixed(2))} Cr`;
  }
  if (amount >= 100000) {
    const lk = amount / 100000;
    return `+₹${parseFloat(lk.toFixed(2))}L`;
  }
  if (amount >= 1000) {
    const k = amount / 1000;
    return `+₹${parseFloat(k.toFixed(1))}K`;
  }
  return `+₹${amount.toLocaleString('en-IN')}`;
}

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}
