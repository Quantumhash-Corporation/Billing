import { deltaSince, getJson } from './http.js';

// Mistral can be read in two ways:
//
// 1. Login session (MISTRAL_SESSION_COOKIE): the same private endpoints the admin panel at
//    admin.mistral.ai uses. Gives the wallet balance, pending usage and a per-model breakdown.
//    These endpoints are not a published API and can change without notice, and the cookie
//    expires, so every reader below fails loudly instead of guessing.
//
// 2. Admin API key (MISTRAL_ADMIN_KEY): the published Admin API,
//    https://docs.mistral.ai/admin/admin-api/usage-metrics. Keys come from
//    backoffice.mistral.ai; a normal API key is refused with 401. The docs name the
//    categories but not the exact response shape, so that reader looks for cost-like fields.

const PANEL = 'https://admin.mistral.ai';
const ADMIN_USAGE = 'https://api.mistral.ai/v1/admin/usage';
const CATEGORIES = [
  'chat',
  'completion',
  'ocr',
  'audio',
  'connectors',
  'libraries_api',
  'fine_tuning',
  'vibe_usage',
];
const COST_KEYS = ['total_cost', 'cost', 'billed_amount', 'amount', 'total_price', 'price', 'total'];

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

function costOf(node) {
  if (Array.isArray(node)) return node.reduce((sum, n) => sum + costOf(n), 0);
  if (!node || typeof node !== 'object') return 0;
  for (const k of COST_KEYS) {
    const v = num(node[k]);
    if (v !== null) return v;
  }
  return Object.values(node).reduce((sum, n) => sum + costOf(n), 0);
}

/** Admin API: month-to-date total and per-category costs; total is null when nothing recognisable is found. */
export function extractCosts(body) {
  const breakdown = {};
  let seen = false;
  for (const category of CATEGORIES) {
    if (body?.[category] == null) continue;
    seen = true;
    const cost = costOf(body[category]);
    if (cost) breakdown[category.replace(/_/g, ' ')] = { cost };
  }
  let total = null;
  for (const k of ['total_cost', 'total', 'total_amount']) {
    total = num(body?.[k]);
    if (total !== null) break;
  }
  if (total === null && seen) {
    total = Object.values(breakdown).reduce((sum, b) => sum + b.cost, 0);
  }
  const currency = typeof body?.currency === 'string' ? body.currency.toUpperCase().slice(0, 3) : null;
  return { total, breakdown, currency };
}

/** Panel billing page -> { wallet, pending, currency }, or null when the figures are not there. */
export function parseBilling(text) {
  const field = (name) => {
    const m = text.match(new RegExp(`\\\\?"${name}\\\\?":\\s*(-?\\d+(?:\\.\\d+)?)`));
    return m ? Number(m[1]) : null;
  };
  const wallet = field('wallet_amount');
  if (wallet === null) return null;
  const currency = text.match(/\\?"currency\\?":\\?"([A-Za-z]{3})\\?"/)?.[1]?.toUpperCase() || null;
  // pending usage is taken as a size, whichever sign Mistral reports it with
  return { wallet, pending: Math.abs(field('ongoing_usage_balance') ?? 0), currency };
}

/** Panel usage.costBreakdown -> { 'model (pages)': { units, requests } } or null */
export function parseBreakdown(body) {
  const groups = body?.result?.data?.json?.groups;
  if (!Array.isArray(groups) || !groups.length) return null;
  const out = {};
  for (const g of groups) {
    const name = g.billingDisplayName || g.billingMetric || g.usageType || 'other';
    const label = g.billingGroup ? `${name} (${g.billingGroup})` : name;
    const entry = (out[label] ||= { units: 0, requests: 0 });
    entry.units += Number(g.value) || 0;
    entry.requests += Number(g.count) || 0;
  }
  return out;
}

const AUTH = 'https://auth.mistral.ai';
const SESSION_EXPIRED =
  'The Mistral login session has expired. Add MISTRAL_EMAIL and MISTRAL_PASSWORD to .env so the dashboard can sign in again by itself, or paste a fresh cookie into MISTRAL_SESSION_COOKIE.';
const AUTO_LOGIN_PAUSE_MS = 6 * 3600_000;

const errorTexts = (flow) =>
  [...(flow?.ui?.messages || []), ...(flow?.ui?.nodes || []).flatMap((n) => n.messages || [])]
    .filter((m) => m.type === 'error')
    .map((m) => m.text);

/**
 * Sign in to Mistral with email and password and return the session cookie ("name=value").
 * Mistral's login is an Ory Kratos browser flow: start a flow, send the email, then the
 * password; each answer is either the next form or the finished session. Anything else it
 * may ask for (captcha, one-time code, passkey) stops here with a message saying so.
 */
export async function login(email, password, fetchImpl = fetch) {
  const jar = new Map();
  const send = async (url, init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...init.headers,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        },
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new Error('Could not reach auth.mistral.ai');
    }
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const at = pair.indexOf('=');
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
    }
    const body = await res.json().catch(() => null);
    return { res, body };
  };
  const session = () => {
    const found = [...jar].find(([name]) => name.startsWith('ory_session'));
    return found ? `${found[0]}=${found[1]}` : null;
  };

  let { res, body: flow } = await send(
    `${AUTH}/self-service/login/browser?return_to=${encodeURIComponent(`${PANEL}/`)}`,
  );
  if (!flow?.ui?.action) throw new Error(`Mistral did not start a sign-in (it answered ${res.status}).`);

  for (let step = 0; step < 4; step += 1) {
    const nodes = flow.ui.nodes || [];
    const has = (name) => nodes.some((n) => n.attributes?.name === name);
    const csrf = nodes.find((n) => n.attributes?.name === 'csrf_token')?.attributes?.value;
    if (nodes.some((n) => /captcha|turnstile/i.test(JSON.stringify(n.attributes || {})))) {
      throw new Error('Mistral asked for a captcha, so the dashboard cannot sign in by itself.');
    }
    let payload = null;
    if (has('password')) payload = { method: 'password', identifier: email, password, csrf_token: csrf };
    else if (has('identifier')) payload = { method: 'identifier_first', identifier: email, csrf_token: csrf };
    if (!payload) {
      const offered = [...new Set(nodes.map((n) => n.group))].filter((g) => g !== 'default').join(', ');
      throw new Error(
        `Mistral did not offer a password step (it offered: ${offered || 'nothing'}). Accounts that sign in with Google, a code or a second factor cannot be signed in automatically.`,
      );
    }

    const answer = await send(flow.ui.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const cookie = session();
    if (cookie) return cookie;

    const errors = errorTexts(answer.body);
    if (errors.length) throw new Error(`Mistral refused the sign-in: ${errors.join(' ')}`);
    if (!answer.body?.ui?.action) {
      const where = answer.body?.redirect_browser_to ? ' and asked for an extra step in the browser' : '';
      throw new Error(`Mistral's sign-in answered ${answer.res.status}${where}, without a session.`);
    }
    flow = answer.body;
  }
  throw new Error('Mistral kept asking for more sign-in steps.');
}

let lastManualLogin = 0;

const credentials = (key) => ({ email: key('MISTRAL_EMAIL'), password: key('MISTRAL_PASSWORD') });

/** Sign in and remember the new session. `auto` backs off after a failure so a wrong password is not retried every hour. */
async function renewSession(key, state, { auto = false } = {}) {
  const { email, password } = credentials(key);
  if (!email || !password) {
    throw new Error('Add MISTRAL_EMAIL and MISTRAL_PASSWORD to .env and restart the server first.');
  }
  if (auto) {
    const failed = await state.get('login_failed');
    if (failed?.at && Date.now() - failed.at < AUTO_LOGIN_PAUSE_MS) {
      throw new Error(`Automatic sign-in to Mistral failed: ${failed.message} Fix it, then use "Refresh login" on the card.`);
    }
  }
  try {
    const cookie = await login(email, password);
    await state.set('session', { cookie, at: Date.now() });
    await state.set('login_failed', { at: 0 });
    return cookie;
  } catch (err) {
    await state.set('login_failed', { at: Date.now(), message: err.message });
    throw err;
  }
}

/** Try every session we know of; when all have expired, sign in again if we can. */
async function syncViaPanel(key, state) {
  const stored = (await state.get('session'))?.cookie;
  const cookies = [...new Set([stored, key('MISTRAL_SESSION_COOKIE')].filter(Boolean))];
  for (const cookie of cookies) {
    try {
      return await syncWithSession(cookie, state);
    } catch (err) {
      if (err.message !== SESSION_EXPIRED) throw err;
    }
  }
  const { email, password } = credentials(key);
  if (!email || !password) throw new Error(SESSION_EXPIRED);
  return syncWithSession(await renewSession(key, state, { auto: true }), state);
}

async function panelFetch(path, cookie, headers = {}) {
  let url = new URL(path, PANEL);
  // Redirects are followed by hand: the panel bounces between its own URLs, while a
  // signed-out session is sent to another host, where the cookie must not travel.
  for (let hop = 0; hop < 4; hop += 1) {
    let res;
    try {
      res = await fetch(url, {
        headers: { cookie, accept: '*/*', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new Error('Could not reach admin.mistral.ai');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') || '', url);
      if (next.origin !== PANEL || /login|sign-?in|auth/i.test(next.pathname)) throw new Error(SESSION_EXPIRED);
      url = next;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(SESSION_EXPIRED);
    if (!res.ok) throw new Error(`admin.mistral.ai answered ${res.status}`);
    return res.text();
  }
  throw new Error('admin.mistral.ai kept redirecting');
}

async function syncWithSession(cookie, state) {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;

  const billing = parseBilling(await panelFetch('/organization/billing?_rsc=1', cookie, { rsc: '1' }));
  if (!billing) {
    throw new Error(
      'Signed in to admin.mistral.ai, but the billing page no longer contains the wallet figures. Mistral may have changed the page.',
    );
  }
  // What is left once this month's not-yet-invoiced usage is taken off the wallet.
  const amount = billing.wallet - billing.pending;

  // The ring needs a "full" mark: the highest balance seen since the last top-up.
  const peak = await state.get('balance_peak');
  const capacity = !peak || amount > peak.last ? amount : Math.max(peak.capacity, amount);
  await state.set('balance_peak', { capacity, last: amount });

  // The breakdown is a nice-to-have; a failure here must not hide the balance.
  let breakdown = null;
  let calls = 0;
  let note = null;
  try {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const input = encodeURIComponent(
      JSON.stringify({
        json: { end: now.toISOString(), start: monthStart.toISOString() },
        meta: { values: { end: ['Date'], start: ['Date'] }, v: 1 },
      }),
    );
    const text = await panelFetch(`/api/local-trpc/usage.costBreakdown?input=${input}`, cookie, {
      'x-trpc-source': 'nextjs-react',
    });
    breakdown = parseBreakdown(JSON.parse(text));
    calls = Object.values(breakdown || {}).reduce((sum, b) => sum + b.requests, 0);
  } catch (err) {
    note = `Balance is up to date; the usage breakdown is not (${err.message})`;
  }

  return {
    addToday: {
      cost: await deltaSince(state, 'month_cost', period, billing.pending),
      requests: await deltaSince(state, 'month_calls', period, calls),
    },
    periodCost: billing.pending,
    breakdown,
    currency: billing.currency,
    extra: {
      reportedBalance: { amount, capacity, wallet: billing.wallet, pending: billing.pending },
      breakdownScope: 'this month',
    },
    note,
  };
}

async function syncWithAdminKey(adminKey, state) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  let body;
  try {
    body = await getJson(`${ADMIN_USAGE}?month=${month}&year=${year}`, { 'x-api-key': adminKey });
  } catch (err) {
    // A normal Mistral API key works for chat but is refused here with 401.
    if (/answered 401/.test(err.message)) {
      throw new Error(
        'Mistral only gives usage to an Admin API key (created at backoffice.mistral.ai). The key in .env is a normal API key.',
      );
    }
    throw err;
  }
  await state.set('last_raw', { text: JSON.stringify(body).slice(0, 4000) });

  const { total, breakdown, currency } = extractCosts(body);
  if (total === null) {
    return {
      note: 'Connected, but no cost figure was found in Mistral’s answer. The raw answer is saved for inspection.',
    };
  }
  const added = await deltaSince(state, 'month_cost', `${year}-${month}`, total);
  return { addToday: { cost: added }, periodCost: total, breakdown, currency };
}

export default {
  id: 'mistral',
  name: 'Mistral',
  kind: 'prepaid',
  keys: [],
  // any one is enough; the admin panel (session or email + password) is preferred
  keysAny: ['MISTRAL_SESSION_COOKIE', 'MISTRAL_EMAIL', 'MISTRAL_ADMIN_KEY'],
  unitLabel: null,

  async sync({ key, state }) {
    const viaPanel = key('MISTRAL_SESSION_COOKIE') || key('MISTRAL_EMAIL') || (await state.get('session'));
    if (viaPanel) return syncViaPanel(key, state);
    return syncWithAdminKey(key('MISTRAL_ADMIN_KEY'), state);
  },

  /** Sign in again now and store the fresh session (the "Refresh login" button). */
  async reconnect({ key, state }) {
    const { email, password } = credentials(key);
    if (!email || !password) {
      throw new Error('Add MISTRAL_EMAIL and MISTRAL_PASSWORD to .env and restart the server first.');
    }
    // Repeated sign-ins in a short time can get an account locked.
    if (Date.now() - lastManualLogin < 60_000) {
      throw new Error('A sign-in was tried less than a minute ago. Wait a moment and try again.');
    }
    lastManualLogin = Date.now();
    await renewSession(key, state);
  },
};
