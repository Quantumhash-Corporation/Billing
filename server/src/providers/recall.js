import { addDays, dayStr, lastDays } from '../balance.js';
import { getJson } from './http.js';

// Docs: https://docs.recall.ai/reference/billing_usage_retrieve
// The endpoint returns bot seconds for a time range and allows 5 requests a minute,
// so each sync reads today plus at most three older days until the last 30 are filled in.
// It says nothing about transcription, which is billed on top for the time recorded,
// so that is added up from the bot list. There is no balance endpoint.
const REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'];
const BACKFILL_PER_SYNC = 3;
const TRANSCRIPTION_RATE = 0.15;
const MAX_PAGES = 10;

/** Bot list -> Map<day, seconds recorded by bots that transcribe> */
export function parseTranscribed(bots) {
  const out = new Map();
  for (const bot of bots) {
    if (!bot?.recording_config?.transcript) continue;
    const at = (code) => bot.status_changes?.find((s) => s.code === code)?.created_at;
    const start = at('in_call_recording');
    const end = at('recording_done') || at('call_ended');
    if (!start || !end) continue;
    const seconds = (Date.parse(end) - Date.parse(start)) / 1000;
    if (seconds > 0) out.set(dayStr(start), (out.get(dayStr(start)) || 0) + seconds);
  }
  return out;
}

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
    const base = `https://${region}.recall.ai`;
    const headers = { Authorization: `Token ${key('RECALL_API_KEY')}` };
    const rate = Number(service.unit_rate) || 0;
    const today = dayStr();
    const window = lastDays(30, today);

    const bots = [];
    let query = new URLSearchParams({ join_at_after: `${window[0]}T00:00:00Z` }).toString();
    for (let page = 0; page < MAX_PAGES && query; page += 1) {
      const body = await getJson(`${base}/api/v1/bot/?${query}`, headers);
      bots.push(...(body.results || []));
      // Only the query string of `next` is reused, so requests never leave `base`.
      query = body.next ? new URL(body.next, base).search.slice(1) : null;
    }
    const transcribed = parseTranscribed(bots);

    const readDay = async (day) => {
      const qs = new URLSearchParams({
        start: `${day}T00:00:00Z`,
        end: `${addDays(day, 1)}T00:00:00Z`,
      });
      const body = await getJson(`${base}/api/v1/billing/usage/?${qs}`, headers);
      const hours = (Number(body.bot_total) || 0) / 3600;
      const botCost = hours * rate;
      const transcription = ((transcribed.get(day) || 0) / 3600) * TRANSCRIPTION_RATE;
      return {
        day,
        cost: botCost + transcription,
        units: hours,
        requests: 0,
        breakdown: { 'Bot time': { cost: botCost }, Transcription: { cost: transcription } },
      };
    };

    // v2: days stored before transcription was counted are read again.
    const done = new Set(((await state.get('backfilled_v2')) || []).filter((d) => window.includes(d)));
    const todo = window.filter((d) => d !== today && !done.has(d)).slice(-BACKFILL_PER_SYNC);

    const days = [await readDay(today)];
    for (const day of todo) {
      days.push(await readDay(day));
      done.add(day);
    }
    await state.set('backfilled_v2', [...done]);

    const left = window.length - 1 - done.size;
    return { days, note: left > 0 ? `Filling in history: ${left} earlier days still to read` : null };
  },
};
