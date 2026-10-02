import { addDays, dayStr } from '../balance.js';
import { getJson } from './http.js';

// Docs: https://platform.openai.com/docs/api-reference/usage — both endpoints need an admin key.
const BASE = 'https://api.openai.com/v1/organization';
const DAYS = 31;

async function buckets(path, params, headers) {
  const all = [];
  let page;
  for (let i = 0; i < 10; i += 1) {
    const qs = new URLSearchParams({ ...params, ...(page ? { page } : {}) });
    const body = await getJson(`${BASE}/${path}?${qs}`, headers);
    all.push(...(body.data || []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return all;
}

const bucketDay = (bucket) => dayStr(bucket.start_time * 1000);

/** Costs buckets -> Map<day, cost> */
export function parseCosts(list) {
  const out = new Map();
  for (const bucket of list) {
    const cost = (bucket.results || []).reduce((sum, r) => sum + (Number(r.amount?.value) || 0), 0);
    out.set(bucketDay(bucket), cost);
  }
  return out;
}

/** Completions usage buckets (grouped by model) -> Map<day, { units, requests, breakdown }> */
export function parseUsage(list) {
  const out = new Map();
  for (const bucket of list) {
    const row = { units: 0, requests: 0, breakdown: {} };
    for (const r of bucket.results || []) {
      const tokens = (r.input_tokens || 0) + (r.output_tokens || 0);
      const requests = r.num_model_requests || 0;
      row.units += tokens;
      row.requests += requests;
      const model = r.model || 'other';
      const entry = (row.breakdown[model] ||= { units: 0, requests: 0 });
      entry.units += tokens;
      entry.requests += requests;
    }
    out.set(bucketDay(bucket), row);
  }
  return out;
}

export default {
  id: 'openai',
  name: 'OpenAI',
  kind: 'prepaid',
  keys: ['OPENAI_ADMIN_KEY'],
  unitLabel: 'tokens',

  async sync({ key }) {
    const headers = { Authorization: `Bearer ${key('OPENAI_ADMIN_KEY')}` };
    const today = dayStr();
    const start = Date.parse(`${addDays(today, -(DAYS - 1))}T00:00:00Z`) / 1000;
    const params = { start_time: String(start), bucket_width: '1d', limit: String(DAYS) };

    const costs = parseCosts(await buckets('costs', params, headers));

    // Token counts are a nice-to-have; a failure here must not hide the cost figures.
    let usage = new Map();
    let note = null;
    try {
      usage = parseUsage(
        await buckets('usage/completions', { ...params, group_by: 'model' }, headers),
      );
    } catch (err) {
      note = `Costs are up to date; token counts are not (${err.message})`;
    }

    const days = [...new Set([...costs.keys(), ...usage.keys()])].map((day) => ({
      day,
      cost: costs.get(day) || 0,
      units: usage.get(day)?.units || 0,
      requests: usage.get(day)?.requests || 0,
      breakdown: usage.get(day)?.breakdown || null,
    }));
    return { days, note };
  },
};
