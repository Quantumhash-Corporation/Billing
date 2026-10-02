import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBalance, dailyAverage, lastDays, renewalCycle } from '../src/balance.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('no ledger entries means the balance is unknown', () => {
  assert.equal(computeBalance([], new Map()), null);
});

test('balance is the set amount minus what was spent afterwards', () => {
  const ledger = [{ kind: 'set', amount: 50, happened_at: '2026-10-01T10:00:00Z', day_cost_baseline: 2 }];
  const costs = new Map([
    ['2026-09-30', 9], // before the anchor: ignored
    ['2026-10-01', 3.5], // 2 was already spent when the balance was set
    ['2026-10-02', 4],
  ]);
  const result = computeBalance(ledger, costs);
  near(result.balance, 50 - 1.5 - 4);
  near(result.capacity, 50);
});

test('top-ups after the anchor add to the balance; earlier ones do not', () => {
  const ledger = [
    { kind: 'topup', amount: 99, happened_at: '2026-09-20T00:00:00Z', day_cost_baseline: 0 },
    { kind: 'set', amount: 10, happened_at: '2026-10-01T00:00:00Z', day_cost_baseline: 0 },
    { kind: 'topup', amount: 25, happened_at: '2026-10-02T00:00:00Z', day_cost_baseline: 0 },
  ];
  const result = computeBalance(ledger, new Map([['2026-10-02', 5]]));
  near(result.capacity, 35);
  near(result.balance, 30);
});

test('backfilling older days does not change the balance', () => {
  const ledger = [{ kind: 'set', amount: 20, happened_at: '2026-10-02T12:00:00Z', day_cost_baseline: 0 }];
  const before = computeBalance(ledger, new Map());
  const after = computeBalance(ledger, new Map([['2026-09-15', 7], ['2026-10-01', 3]]));
  near(before.balance, after.balance);
});

test('monthly renewal picks this month or the next', () => {
  assert.equal(renewalCycle('2026-01-15', 'monthly', '2026-10-02').next, '2026-10-15');
  assert.equal(renewalCycle('2026-01-01', 'monthly', '2026-10-02').next, '2026-11-01');
  assert.equal(renewalCycle('2026-01-02', 'monthly', '2026-10-02').daysLeft, 0);
});

test('a renewal on the 31st is clamped in shorter months', () => {
  const cycle = renewalCycle('2026-01-31', 'monthly', '2027-02-10');
  assert.equal(cycle.next, '2027-02-28');
  assert.equal(cycle.prev, '2027-01-31');
  assert.equal(cycle.cycleDays, 28);
});

test('monthly renewal rolls over the year end', () => {
  const cycle = renewalCycle('2026-03-10', 'monthly', '2026-12-20');
  assert.equal(cycle.next, '2027-01-10');
  assert.equal(cycle.prev, '2026-12-10');
});

test('yearly renewal and future anchors', () => {
  assert.equal(renewalCycle('2025-03-10', 'yearly', '2026-10-02').next, '2027-03-10');
  assert.equal(renewalCycle('2027-06-01', 'monthly', '2026-10-02').next, '2027-06-01');
  assert.equal(renewalCycle(null, 'monthly', '2026-10-02'), null);
});

test('lastDays ends today and dailyAverage skips today', () => {
  assert.deepEqual(lastDays(3, '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  const costs = new Map([['2026-03-01', 100], ['2026-02-28', 7], ['2026-02-27', 7]]);
  near(dailyAverage(costs, 7, '2026-03-01'), 2);
});
