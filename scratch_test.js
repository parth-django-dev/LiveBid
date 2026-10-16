import { Counter } from 'k6/metrics';
const c = new Counter('bids_confirmed');
const thresholds = {};
for (let a = 1; a <= 5; a++) {
  thresholds[`bids_confirmed{auction:${a}}`] = [];
}
export const options = {
  thresholds: thresholds,
};
export default function() {
  c.add(1, { auction: String(__VU) });
}
export function handleSummary(data) {
  for (let a = 1; a <= 5; a++) {
    const k = `bids_confirmed{auction:${a}}`;
    console.log(k, data.metrics[k] ? data.metrics[k].values.count : 0);
  }
  return {};
}
