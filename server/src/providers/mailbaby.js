import { deltaSince, getJson } from './http.js';

// Spec: https://api.mailbaby.net/spec/openapi.yaml
// /mail/stats?time=billing gives emails sent and the estimated cost for the current
// billing cycle. The API does not say when the cycle ends; enter that in the dashboard.
const BASE = 'https://api.mailbaby.net';

export default {
  id: 'mailbaby',
  name: 'MailBaby',
  kind: 'subscription',
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

    return {
      addToday: { cost: addedCost, units: addedEmails },
      periodCost: cost,
      currency: typeof stats.currency === 'string' ? stats.currency.toUpperCase().slice(0, 3) : null,
      extra: {
        cycle: {
          emails,
          sent: Number(stats.sent) || 0,
          received: Number(stats.received) || 0,
        },
      },
    };
  },
};
