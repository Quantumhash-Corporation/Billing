import { addDays, dayStr } from '../balance.js';
import { balancePeak, getJson } from './http.js';

// Docs: https://www.cheaperinference.com/docs
// /v1/usage/daily gives spend and request counts per day (needs a key with usage:read);
// /v1/account/balance gives the wallet (needs account:read). Both come from the same key.
const BASE = 'https://api.cheaperinference.com/v1';
const DAYS = 31;

/** usage.daily body -> [{ day, cost, units, requests }] ; units are prompt tokens */
export function parseDaily(body) {
  const rows = Array.isArray(body?.daily_spend) ? body.daily_spend : [];
  return rows
    .filter((r) => typeof r?.date === 'string')
    .map((r) => ({
      day: r.date.slice(0, 10),
      cost: Number(r.spend_usd) || 0,
      units: Number(r.prompt_tokens) || 0,
      requests: Number(r.request_count) || 0,
      breakdown: null,
    }));
}

/** account.balance body -> { amount, reserved } or null. Spendable money excludes reserved funds. */
export function parseBalance(body) {
  const amount = Number(body?.available_usd ?? body?.balance_usd);
  if (body?.available_usd == null && body?.balance_usd == null) return null;
  if (!Number.isFinite(amount)) return null;
  return { amount, reserved: Number(body.reserved_usd) || 0 };
}

export default {
  id: 'cheaperinference',
  name: 'Cheaper Inference',
  kind: 'prepaid',
  keys: ['CHEAPERINFERENCE_API_KEY'],
  unitLabel: 'prompt tokens',

  async sync({ key, state }) {
    const headers = { Authorization: `Bearer ${key('CHEAPERINFERENCE_API_KEY')}` };
    const today = dayStr();
    const qs = new URLSearchParams({
      start_at: `${addDays(today, -(DAYS - 1))}T00:00:00Z`,
      end_at: `${addDays(today, 1)}T00:00:00Z`,
    });
    const days = parseDaily(await getJson(`${BASE}/usage/daily?${qs}`, headers));

    // The balance is a nice-to-have; a key without account:read must not hide the usage.
    let note = null;
    let extra;
    try {
      const balance = parseBalance(await getJson(`${BASE}/account/balance`, headers));
      if (balance) {
        const capacity = await balancePeak(state, balance.amount);
        extra = { reportedBalance: { amount: balance.amount, capacity, reserved: balance.reserved } };
      } else {
        note = 'Usage is up to date; the balance answer had no figures.';
      }
    } catch (err) {
      note = `Usage is up to date; the balance is not (${err.message}). The key needs the account:read scope.`;
    }
    return { days, currency: 'USD', extra, note };
  },
};
