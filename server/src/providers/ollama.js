import { getJson } from './http.js';

// Ollama Cloud is a subscription: there is no cost or balance to read. The only signal is
// GET https://ollama.com/api/usage, which is not in Ollama's published API docs and reports
// how much of each usage window has been used as a 0..1 fraction. The renewal date and
// plan price come from the settings you enter in the dashboard.
const LABELS = { session: '5-hour window', weekly: 'This week', monthly: 'This month' };

/** -> [{ name, label, used }] with `used` as a 0..1 fraction */
export function parseUsage(body) {
  const limits = body?.limits;
  if (!limits || typeof limits !== 'object') return [];
  return Object.entries(limits)
    .filter(([, w]) => typeof w?.usage === 'number')
    .map(([name, w]) => ({
      name,
      label: LABELS[name] || name,
      used: Math.min(1, Math.max(0, w.usage)),
    }));
}

/** Requests per model for the longest window reported -> { model: { requests } } or null */
export function parseModels(body) {
  const limits = body?.limits || {};
  const window = limits.monthly || limits.weekly || limits.session;
  if (!Array.isArray(window?.models) || !window.models.length) return null;
  const out = {};
  for (const m of window.models) {
    if (m?.name) out[m.name] = { requests: Number(m.request_count) || 0 };
  }
  return Object.keys(out).length ? out : null;
}

export default {
  id: 'ollama',
  name: 'Ollama Cloud',
  kind: 'subscription',
  keys: ['OLLAMA_API_KEY'],
  unitLabel: null,

  async sync({ key, state }) {
    const body = await getJson('https://ollama.com/api/usage', {
      Authorization: `Bearer ${key('OLLAMA_API_KEY')}`,
    });
    await state.set('last_raw', { text: JSON.stringify(body).slice(0, 4000) });
    const windows = parseUsage(body);
    return {
      extra: { windows, breakdownScope: 'current usage window' },
      breakdown: parseModels(body),
      note: windows.length ? null : 'Connected, but Ollama returned no usage figures for this plan.',
    };
  },
};
