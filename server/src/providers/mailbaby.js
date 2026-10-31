import { deltaSince, getJson } from './http.js';

// Spec: https://api.mailbaby.net/spec/openapi.yaml
// /mail/stats?time=billing gives emails sent and the estimated cost for the current
// billing cycle. The API does not say when the cycle ends; enter that in the dashboard.
const BASE = 'https://api.mailbaby.net';
// The same key opens the InterServer account that pays for MailBaby. The prepay there only
// drops when an invoice is paid, so it stays level between invoices while usage adds up.
const PREPAYS = 'https://my.interserver.net/apiv2/billing/prepays';

/** billing/prepays body -> { amount, capacity, currency } for funds usable on mail, or null */
export function parsePrepay(body) {
  const entries = Object.values(body?.prepays || {})
    .map((p) => p?.prepay)
    .filter((p) => p && String(p.prepay_deleted) !== '1' && [null, undefined, '', 'default', 'mail'].includes(p.prepay_module));
  if (!entries.length) return null;
  const sum = (field) => entries.reduce((total, p) => total + (Number(p[field]) || 0), 0);
  return { amount: sum('prepay_remaining'), capacity: sum('prepay_amount'), currency: entries[0].prepay_currency || null };
}

export default {
  id: 'mailbaby',
  name: 'MailBaby',
  kind: 'prepaid',
  keys: ['MAILBABY_API_KEY'],
  unitLabel: 'emails',

  async sync({ key, state }) {
    const headers = { 'X-API-KEY': key('MAILBABY_API_KEY') };
    const stats = await getJson(`${BASE}/mail/stats?time=billing`, headers);
    const cost = Number(stats.cost) || 0;
    const emails = Number(stats.usage) || 0;

    // No cycle id is exposed, so a total that drops means a new cycle began.
    const addedCost = await deltaSince(state, 'cycle_cost', 'cycle', cost);
    const addedEmails = await deltaSince(state, 'cycle_emails', 'cycle', emails);

    // The balance is a nice-to-have; a failure here must not hide the usage.
    let reportedBalance;
    let note = null;
    try {
      const prepay = parsePrepay(await getJson(PREPAYS, headers));
      if (prepay) reportedBalance = { amount: prepay.amount, capacity: prepay.capacity };
      else note = 'Usage is up to date; InterServer listed no prepay for mail.';
    } catch (err) {
      note = `Usage is up to date; the balance is not (${err.message})`;
    }

    return {
      addToday: { cost: addedCost, units: addedEmails },
      periodCost: cost,
      currency: typeof stats.currency === 'string' ? stats.currency.toUpperCase().slice(0, 3) : null,
      extra: {
        reportedBalance,
        cycle: {
          emails,
          sent: Number(stats.sent) || 0,
          received: Number(stats.received) || 0,
        },
      },
      note,
    };
  },
};
