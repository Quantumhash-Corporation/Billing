// Pure date and money maths. All days are UTC 'YYYY-MM-DD' strings.

const DAY_MS = 86400000;

export const dayStr = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

export const addDays = (day, n) => dayStr(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The last `n` days ending today, oldest first. */
export function lastDays(n, today = dayStr()) {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Renewal date in a given month, clamped so "31st" lands on the 30th/28th when needed.
function inMonth(year, month, anchorDom) {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(anchorDom, daysInMonth(y, m)))}`;
}

/**
 * Next renewal on or after `today`, plus the cycle it closes.
 * `anchor` is any date the service renewed (or will renew) on.
 */
export function renewalCycle(anchor, interval, today = dayStr()) {
  if (!anchor) return null;
  const [ay, am, ad] = anchor.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  const step = interval === 'yearly' ? 12 : 1;

  let next;
  let prev;
  if (interval === 'yearly') {
    let year = ty;
    if (inMonth(year, am, ad) < today) year += 1;
    next = inMonth(year, am, ad);
    prev = inMonth(year - 1, am, ad);
  } else {
    let offset = 0;
    if (inMonth(ty, tm, ad) < today) offset = 1;
    next = inMonth(ty, tm + offset, ad);
    prev = inMonth(ty, tm + offset - step, ad);
  }
  // A future anchor is itself the next renewal, even if it is more than one cycle away.
  if (anchor > next) {
    next = anchor;
    prev = inMonth(ay, am - step, ad);
  }
  const cycleDays = Math.max(1, daysBetween(prev, next));
  const daysLeft = daysBetween(today, next);
  return { next, prev, cycleDays, daysLeft };
}

/**
 * Balance for a prepaid service.
 * ledger: [{ kind: 'set'|'topup', amount, happened_at, day_cost_baseline }]
 * dailyCost: Map<day, cost>
 *
 * The anchor is the latest "set" entry (or the first entry if there is none).
 * Money spent since then is every later day's cost, plus whatever was added to the
 * anchor's own day after the anchor was recorded.
 */
export function computeBalance(ledger, dailyCost) {
  if (!ledger.length) return null;
  const entries = [...ledger].sort((a, b) => new Date(a.happened_at) - new Date(b.happened_at));
  const lastSet = entries.findLast((e) => e.kind === 'set');
  const anchor = lastSet ?? entries[0];
  const anchorAt = new Date(anchor.happened_at);
  const anchorDay = dayStr(anchorAt);

  const topups = entries
    .filter((e) => e !== anchor && e.kind === 'topup' && new Date(e.happened_at) > anchorAt)
    .reduce((sum, e) => sum + Number(e.amount), 0);

  let spent = 0;
  for (const [day, cost] of dailyCost) {
    if (day > anchorDay) spent += cost;
    else if (day === anchorDay) spent += Math.max(0, cost - Number(anchor.day_cost_baseline || 0));
  }

  const capacity = Number(anchor.amount) + topups;
  return { balance: capacity - spent, capacity, spent, since: anchorAt.toISOString() };
}

/** Average daily cost over the last `n` full days (today excluded: it is still filling up). */
export function dailyAverage(dailyCost, n = 7, today = dayStr()) {
  let sum = 0;
  for (let i = 1; i <= n; i += 1) sum += dailyCost.get(addDays(today, -i)) || 0;
  return sum / n;
}
