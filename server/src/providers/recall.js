import { addDays, dayStr, lastDays } from '../balance.js';
import { getJson } from './http.js';

// Docs: https://docs.recall.ai/reference/billing_usage_retrieve
// The endpoint returns bot seconds for a time range and allows 5 requests a minute,
// so each sync reads today plus at most three older days until the last 30 are filled in.
const REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'];
const BACKFILL_PER_SYNC = 3;

export default {
  id: 'recall',
  name: 'Recall.ai',
  kind: 'prepaid',
  keys: ['RECALL_API_KEY'],
  unitRate: 0.5,
  unitLabel: 'bot hours',

  async sync({ key, service, state }) {
    const region = key('RECALL_REGION') || 'us-west-2';
    if (!REGIONS.includes(region)) {
      throw new Error(`RECALL_REGION must be one of ${REGIONS.join(', ')}`);
    }
    const headers = { Authorization: `Token ${key('RECALL_API_KEY')}` };
    const rate = Number(service.unit_rate) || 0;

    const readDay = async (day) => {
      const qs = new URLSearchParams({
        start: `${day}T00:00:00Z`,
        end: `${addDays(day, 1)}T00:00:00Z`,
      });
      const body = await getJson(`https://${region}.recall.ai/api/v1/billing/usage/?${qs}`, headers);
      const hours = (Number(body.bot_total) || 0) / 3600;
      return { day, cost: hours * rate, units: hours, requests: 0, breakdown: null };
    };

    const today = dayStr();
    const window = lastDays(30, today);
    const done = new Set(((await state.get('backfilled')) || []).filter((d) => window.includes(d)));
    const todo = window.filter((d) => d !== today && !done.has(d)).slice(-BACKFILL_PER_SYNC);

    const days = [await readDay(today)];
    for (const day of todo) {
      days.push(await readDay(day));
      done.add(day);
    }
    await state.set('backfilled', [...done]);

    const left = window.length - 1 - done.size;
    return { days, note: left > 0 ? `Filling in history: ${left} earlier days still to read` : null };
  },
};
