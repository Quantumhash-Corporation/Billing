import { Router } from 'express';
import { dayStr } from './balance.js';
import { pool, stateFor } from './db.js';
import { isSignedIn, login, logout, requireSession, sameOrigin } from './auth.js';
import { buildDetail, buildOverview } from './overview.js';
import { providerById } from './providers/index.js';
import { envKey } from './env.js';
import { syncAll, syncService } from './sync.js';

export const api = Router();

api.use(sameOrigin);

api.get('/session', (req, res) => res.json({ signedIn: isSignedIn(req) }));
api.post('/login', login);
api.post('/logout', logout);

api.use(requireSession);

class Invalid extends Error {}

// Optional money/rate field: '' or null clears it.
function optionalNumber(value, label, max = 1_000_000) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Invalid(`${label} must be between 0 and ${max}.`);
  return n;
}

function optionalText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function service(req) {
  if (!providerById.has(req.params.id)) throw new Invalid('Unknown service.');
  return req.params.id;
}

api.get('/overview', async (_req, res) => {
  res.json(await buildOverview());
});

api.get('/services/:id', async (req, res) => {
  const detail = await buildDetail(service(req));
  if (!detail) return res.status(404).json({ error: 'Unknown service.' });
  return res.json(detail);
});

api.put('/services/:id', async (req, res) => {
  const id = service(req);
  const b = req.body || {};
  if (!['prepaid', 'subscription'].includes(b.kind)) throw new Invalid('Choose prepaid or subscription.');
  if (!['monthly', 'yearly'].includes(b.renewalInterval)) throw new Invalid('Choose monthly or yearly.');
  let anchor = null;
  if (b.renewalAnchor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.renewalAnchor) || Number.isNaN(Date.parse(b.renewalAnchor))) {
      throw new Invalid('Renewal date must be a real date.');
    }
    anchor = b.renewalAnchor;
  }
  await pool.query(
    `UPDATE services SET kind = ?, plan_name = ?, plan_price = ?, renewal_anchor = ?,
       renewal_interval = ?, included_usage = ?, unit_rate = ?, low_balance = ? WHERE id = ?`,
    [
      b.kind,
      optionalText(b.planName, 80),
      optionalNumber(b.planPrice, 'Plan price'),
      anchor,
      b.renewalInterval,
      optionalNumber(b.includedUsage, 'Included usage'),
      optionalNumber(b.unitRate, 'Rate', 10_000),
      optionalNumber(b.lowBalance, 'Low balance warning'),
      id,
    ],
  );
  res.json(await buildDetail(id));
});

api.post('/services/:id/ledger', async (req, res) => {
  const id = service(req);
  const { kind, amount, note } = req.body || {};
  if (!['set', 'topup'].includes(kind)) throw new Invalid('Choose "set balance" or "top-up".');
  const value = Number(amount);
  if (amount === '' || amount == null || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Invalid('Amount must be between 0 and 1,000,000.');
  }
  if (kind === 'topup' && value === 0) throw new Invalid('A top-up needs an amount above zero.');

  // Bring today's cost up to date first, so spend from before this moment is not charged twice.
  await syncService(id);
  const [[today]] = await pool.query('SELECT cost FROM usage_daily WHERE service_id = ? AND day = ?', [
    id,
    dayStr(),
  ]);
  await pool.query(
    `INSERT INTO ledger (service_id, kind, amount, day_cost_baseline, happened_at, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, kind, value, today?.cost || 0, new Date(), optionalText(note, 200)],
  );
  res.status(201).json(await buildDetail(id));
});

api.delete('/services/:id/ledger/:entryId', async (req, res) => {
  const id = service(req);
  const entryId = Number(req.params.entryId);
  if (!Number.isInteger(entryId)) throw new Invalid('Unknown entry.');
  await pool.query('DELETE FROM ledger WHERE id = ? AND service_id = ?', [entryId, id]);
  res.json(await buildDetail(id));
});

// Sign in to the provider again (for services read through a login session), then sync.
api.post('/services/:id/reconnect', async (req, res) => {
  const id = service(req);
  const provider = providerById.get(id);
  if (!provider.reconnect) throw new Invalid('This service does not use a login session.');
  try {
    await provider.reconnect({ key: envKey, state: stateFor(id) });
  } catch (err) {
    throw new Invalid(String(err.message || err));
  }
  await syncService(id, { force: true });
  res.json({ overview: await buildOverview() });
});

api.post('/sync', async (req, res) => {
  const id = req.body?.service;
  const results = id ? [await syncService(String(id))] : await syncAll();
  res.json({ results, overview: await buildOverview() });
});

// eslint-disable-next-line no-unused-vars
api.use((err, _req, res, _next) => {
  if (err instanceof Invalid) return res.status(400).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server. Check the server log.' });
});
