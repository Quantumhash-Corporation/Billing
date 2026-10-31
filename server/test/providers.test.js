import assert from 'node:assert/strict';
import test from 'node:test';
import { deltaSince } from '../src/providers/http.js';
import { extractCosts } from '../src/providers/mistral.js';
import { parseUsage as parseOllama } from '../src/providers/ollama.js';
import { parseCosts, parseUsage } from '../src/providers/openai.js';

const memoryState = () => {
  const data = new Map();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
};

test('openai costs are summed per day', () => {
  const day = Date.parse('2026-10-01T00:00:00Z') / 1000;
  const costs = parseCosts([
    { start_time: day, results: [{ amount: { value: 1.25 } }, { amount: { value: '0.75' } }] },
    { start_time: day + 86400, results: [] },
  ]);
  assert.equal(costs.get('2026-10-01'), 2);
  assert.equal(costs.get('2026-10-02'), 0);
});

test('openai usage is grouped by model', () => {
  const day = Date.parse('2026-10-01T00:00:00Z') / 1000;
  const usage = parseUsage([
    {
      start_time: day,
      results: [
        { model: 'gpt-a', input_tokens: 100, output_tokens: 50, num_model_requests: 2 },
        { model: 'gpt-a', input_tokens: 10, output_tokens: 0, num_model_requests: 1 },
        { model: null, input_tokens: 5, output_tokens: 5, num_model_requests: 1 },
      ],
    },
  ]);
  const row = usage.get('2026-10-01');
  assert.equal(row.units, 170);
  assert.equal(row.requests, 4);
  assert.deepEqual(row.breakdown['gpt-a'], { units: 160, requests: 3 });
  assert.deepEqual(row.breakdown.other, { units: 10, requests: 1 });
});

test('mistral: an explicit total wins', () => {
  const out = extractCosts({ total_cost: 12.5, currency: 'eur', chat: { cost: 10 }, ocr: { cost: 2.5 } });
  assert.equal(out.total, 12.5);
  assert.equal(out.currency, 'EUR');
  assert.deepEqual(out.breakdown, { chat: { cost: 10 }, ocr: { cost: 2.5 } });
});

test('mistral: categories are added up when there is no total, however they nest', () => {
  const out = extractCosts({
    chat: [{ model: 'a', cost: 1 }, { model: 'b', cost: '2.5' }],
    fine_tuning: { jobs: { items: [{ amount: 4 }] } },
    audio: {},
  });
  assert.equal(out.total, 7.5);
  assert.deepEqual(out.breakdown, { chat: { cost: 3.5 }, 'fine tuning': { cost: 4 } });
});

test('mistral: an unrecognised answer gives no total rather than a guess', () => {
  assert.equal(extractCosts({ hello: 'world' }).total, null);
  assert.equal(extractCosts(null).total, null);
});

test('ollama usage windows are read as fractions', () => {
  const windows = parseOllama({ limits: { session: { usage: 0.025 }, weekly: { usage: 1.4 }, x: {} } });
  assert.deepEqual(windows, [
    { name: 'session', label: '5-hour window', used: 0.025 },
    { name: 'weekly', label: 'This week', used: 1 },
  ]);
  assert.deepEqual(parseOllama({}), []);
});

test('cheaperinference: daily spend rows and the spendable balance', async () => {
  const { parseDaily, parseBalance } = await import('../src/providers/cheaperinference.js');
  const rows = parseDaily({
    daily_spend: [
      { date: '2026-06-30', request_count: 24, spend_usd: '3.910042', prompt_tokens: 30500 },
      { date: '2026-07-01', request_count: 0, spend_usd: '0.000000', prompt_tokens: 0 },
    ],
  });
  assert.deepEqual(rows[0], { day: '2026-06-30', cost: 3.910042, units: 30500, requests: 24, breakdown: null });
  assert.equal(rows.length, 2);
  assert.deepEqual(parseDaily({}), []);
  assert.deepEqual(parseBalance({ balance_usd: 124.5, available_usd: 118.02, reserved_usd: 6.48 }), {
    amount: 118.02,
    reserved: 6.48,
  });
  assert.equal(parseBalance({}), null);
});

test('mailbaby: the prepay is read for funds usable on mail', async () => {
  const { parsePrepay } = await import('../src/providers/mailbaby.js');
  const prepay = (fields) => ({ prepay: { prepay_deleted: '0', prepay_currency: 'USD', ...fields } });
  const body = {
    prepays: {
      1: prepay({ prepay_amount: '10.00', prepay_remaining: '6.97', prepay_module: null }),
      2: prepay({ prepay_amount: '5.00', prepay_remaining: '5.00', prepay_module: 'mail' }),
      3: prepay({ prepay_amount: '50.00', prepay_remaining: '50.00', prepay_module: 'vps' }),
      4: prepay({ prepay_amount: '9.00', prepay_remaining: '9.00', prepay_module: null, prepay_deleted: '1' }),
    },
  };
  const out = parsePrepay(body);
  assert.ok(Math.abs(out.amount - 11.97) < 1e-9);
  assert.equal(out.capacity, 15);
  assert.equal(out.currency, 'USD');
  assert.equal(parsePrepay({ prepays: {} }), null);
  assert.equal(parsePrepay(null), null);
});

test('recall: transcribed time is what bots with a transcript recorded', async () => {
  const { parseTranscribed } = await import('../src/providers/recall.js');
  const bot = (transcript, start, end) => ({
    recording_config: { transcript },
    status_changes: [
      { code: 'joining_call', created_at: '2026-10-28T09:00:00Z' },
      { code: 'in_call_recording', created_at: start },
      { code: 'recording_done', created_at: end },
    ],
  });
  const out = parseTranscribed([
    bot({ provider: {} }, '2026-10-28T09:01:00Z', '2026-10-28T09:03:00Z'),
    bot({ provider: {} }, '2026-10-28T10:00:00Z', '2026-10-28T10:00:30Z'),
    bot(null, '2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z'),
    { recording_config: { transcript: {} }, status_changes: [{ code: 'fatal', created_at: '2026-10-28T09:00:00Z' }] },
  ]);
  assert.deepEqual([...out], [['2026-10-28', 150]]);
});

test('balancePeak: a rise restarts the full mark, a fall keeps it', async () => {
  const { balancePeak } = await import('../src/providers/http.js');
  const state = memoryState();
  assert.equal(await balancePeak(state, 50), 50);
  assert.equal(await balancePeak(state, 40), 50);
  assert.equal(await balancePeak(state, 90), 90);
});

test('deltaSince: first sighting counts as zero, then only the increase', async () => {
  const state = memoryState();
  assert.equal(await deltaSince(state, 'c', '2026-10', 30), 0);
  assert.equal(await deltaSince(state, 'c', '2026-10', 34), 4);
  assert.equal(await deltaSince(state, 'c', '2026-10', 34), 0);
});

test('deltaSince: a new period or a reset starts again from zero', async () => {
  const state = memoryState();
  await deltaSince(state, 'c', '2026-10', 30);
  assert.equal(await deltaSince(state, 'c', '2026-11', 3), 3);
  assert.equal(await deltaSince(state, 'c', '2026-11', 1), 1);
});

test('mistral panel: wallet and pending usage are read from the billing page', async () => {
  const { parseBilling } = await import('../src/providers/mistral.js');
  const plain = '{"currency":"usd","wallet_amount":10,"credit_notes_amount":0,"ongoing_usage_balance":2.5}';
  assert.deepEqual(parseBilling(plain), { wallet: 10, pending: 2.5, currency: 'USD' });
  const escaped = String.raw`{\"currency\":\"EUR\",\"wallet_amount\":7.25,\"ongoing_usage_balance\":-1}`;
  assert.deepEqual(parseBilling(escaped), { wallet: 7.25, pending: 1, currency: 'EUR' });
  assert.equal(parseBilling('<html>sign in</html>'), null);
});

test('mistral panel: usage groups become a per-model breakdown', async () => {
  const { parseBreakdown } = await import('../src/providers/mistral.js');
  const body = {
    result: {
      data: {
        json: {
          groups: [
            { billingDisplayName: 'mistral-ocr-latest', billingGroup: 'pages', count: 61, value: 1993 },
            { billingDisplayName: 'mistral-ocr-latest', billingGroup: 'pages', count: 1, value: 7 },
            { billingDisplayName: null, usageType: 'chat', billingGroup: null, count: 2, value: 300 },
          ],
        },
      },
    },
  };
  assert.deepEqual(parseBreakdown(body), {
    'mistral-ocr-latest (pages)': { units: 2000, requests: 62 },
    chat: { units: 300, requests: 2 },
  });
  assert.equal(parseBreakdown({ result: { data: { json: { groups: [] } } } }), null);
});

// A stand-in for Mistral's sign-in service: email step, then password step.
function fakeKratos({ goodPassword = 'right', passwordStep = true } = {}) {
  const calls = [];
  const reply = (status, body, cookies = []) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const c of cookies) headers.append('set-cookie', c);
    return new Response(JSON.stringify(body), { status, headers });
  };
  const flow = (nodes, messages = []) => ({
    ui: {
      action: 'https://auth.mistral.ai/self-service/login?flow=f1',
      messages,
      nodes: [{ group: 'default', attributes: { name: 'csrf_token', value: 'csrf-1' } }, ...nodes],
    },
  });
  const emailForm = [{ group: 'identifier_first', attributes: { name: 'identifier' } }];
  const passwordForm = [{ group: 'password', attributes: { name: 'password' } }];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || 'GET', body, cookie: init.headers.cookie });
    if (!body) return reply(200, flow(emailForm), ['csrf_token_abc=tok; Path=/; HttpOnly']);
    if (body.method === 'identifier_first') {
      return reply(400, flow(passwordStep ? passwordForm : [{ group: 'code', attributes: { name: 'code' } }]));
    }
    if (body.password !== goodPassword) {
      return reply(400, flow(passwordForm, [{ type: 'error', text: 'The provided credentials are invalid.' }]));
    }
    return reply(200, { session: {} }, ['ory_session_proj="abc=="; Path=/; Domain=mistral.ai; HttpOnly']);
  };
  return { fetchImpl, calls };
}

test('mistral sign-in: email, then password, returns the session cookie', async () => {
  const { login } = await import('../src/providers/mistral.js');
  const { fetchImpl, calls } = fakeKratos();
  assert.equal(await login('me@example.com', 'right', fetchImpl), 'ory_session_proj="abc=="');
  assert.deepEqual(calls.map((c) => c.body?.method ?? 'start'), ['start', 'identifier_first', 'password']);
  assert.equal(calls[2].body.csrf_token, 'csrf-1');
  assert.match(calls[1].cookie, /csrf_token_abc=tok/);
});

test('mistral sign-in: a wrong password is reported, not retried', async () => {
  const { login } = await import('../src/providers/mistral.js');
  const { fetchImpl, calls } = fakeKratos();
  await assert.rejects(login('me@example.com', 'wrong', fetchImpl), /refused the sign-in: The provided credentials are invalid/);
  assert.equal(calls.length, 3);
});

test('mistral sign-in: stops when there is no password step', async () => {
  const { login } = await import('../src/providers/mistral.js');
  const { fetchImpl } = fakeKratos({ passwordStep: false });
  await assert.rejects(login('me@example.com', 'right', fetchImpl), /did not offer a password step \(it offered: code\)/);
});

test('mistral sign-in: the password is never sent to another host', async () => {
  const { login } = await import('../src/providers/mistral.js');
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') posts.push(String(url));
    const body = { ui: { action: 'https://evil.example/self-service/login?flow=f1', nodes: [{ group: 'password', attributes: { name: 'password' } }] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(login('me@example.com', 'right', fetchImpl), /unexpected address/);
  assert.deepEqual(posts, []);
});

test('sealed secrets round-trip and fail closed', async () => {
  process.env.SESSION_SECRET ||= 'x'.repeat(40);
  const { seal, unseal } = await import('../src/seal.js');
  const sealed = seal('ory_session_x="abc=="');
  assert.notEqual(sealed, 'ory_session_x="abc=="');
  assert.equal(unseal(sealed), 'ory_session_x="abc=="');
  assert.equal(unseal(sealed.slice(0, -4) + 'AAAA'), null);
  assert.equal(unseal('not-sealed'), null);
});
