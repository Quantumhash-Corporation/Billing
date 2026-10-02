import { dayStr } from './balance.js';
import { pool, stateFor } from './db.js';
import { envKey } from './env.js';
import { providerById, providers } from './providers/index.js';

const MIN_GAP_MS = 60_000;
const running = new Map();
const lastStarted = new Map();

/** Env variables a provider still needs. `keysAny` lists alternatives: one of them is enough. */
export function missingKeys(provider) {
  const missing = provider.keys.filter((k) => !envKey(k));
  if (provider.keysAny && !provider.keysAny.some((k) => envKey(k))) missing.push(provider.keysAny[0]);
  return missing;
}

async function store(serviceId, result) {
  if (result.days?.length) {
    const rows = result.days.map((d) => [
      serviceId,
      d.day,
      d.cost || 0,
      d.units || 0,
      d.requests || 0,
      d.breakdown ? JSON.stringify(d.breakdown) : null,
    ]);
    await pool.query(
      `INSERT INTO usage_daily (service_id, day, cost, units, requests, breakdown) VALUES ? AS new
       ON DUPLICATE KEY UPDATE cost = new.cost, units = new.units,
         requests = new.requests, breakdown = new.breakdown`,
      [rows],
    );
  }
  if (result.addToday) {
    const { cost = 0, units = 0, requests = 0 } = result.addToday;
    await pool.query(
      `INSERT INTO usage_daily (service_id, day, cost, units, requests) VALUES (?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE cost = usage_daily.cost + new.cost,
         units = usage_daily.units + new.units, requests = usage_daily.requests + new.requests`,
      [serviceId, dayStr(), cost, units, requests],
    );
  }
  if (result.currency) {
    await pool.query('UPDATE services SET currency = ? WHERE id = ?', [result.currency, serviceId]);
  }
}

async function run(provider) {
  const started = Date.now();
  let ok = true;
  let message = null;
  try {
    const [[service]] = await pool.query('SELECT * FROM services WHERE id = ?', [provider.id]);
    const state = stateFor(provider.id);
    const result = await provider.sync({ key: envKey, service, state, pool });
    await store(provider.id, result);
    await state.set('extra', {
      ...(result.extra || {}),
      periodCost: result.periodCost ?? null,
      breakdown: result.breakdown ?? null,
    });
    message = result.note || null;
  } catch (err) {
    ok = false;
    message = String(err.message || err).slice(0, 500);
  }
  await pool
    .query('INSERT INTO sync_runs (service_id, ran_at, ok, message, ms) VALUES (?, ?, ?, ?, ?)', [
      provider.id,
      new Date(),
      ok ? 1 : 0,
      message,
      Date.now() - started,
    ])
    .catch(() => {});
  return { id: provider.id, ok, message };
}

/** Sync one service. Calls made within a minute of the last one are skipped unless forced. */
export function syncService(id, { force = false } = {}) {
  const provider = providerById.get(id);
  if (!provider) return Promise.resolve({ id, skipped: 'unknown' });
  if (missingKeys(provider).length) return Promise.resolve({ id, skipped: 'missing-key' });
  if (running.has(id)) return running.get(id);
  if (!force && Date.now() - (lastStarted.get(id) || 0) < MIN_GAP_MS) {
    return Promise.resolve({ id, skipped: 'recent' });
  }
  lastStarted.set(id, Date.now());
  const job = run(provider).finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

export const syncAll = () => Promise.all(providers.map((p) => syncService(p.id)));

const FRESH_MS = 10 * 60_000;

// After a restart, leave alone the services that synced fine a few minutes ago:
// restarts in quick succession would otherwise run into provider rate limits.
async function syncStale() {
  const [rows] = await pool.query(
    `SELECT r.service_id, r.ran_at, r.ok FROM sync_runs r
       JOIN (SELECT MAX(id) AS id FROM sync_runs GROUP BY service_id) m ON m.id = r.id`,
  );
  const fresh = new Set(
    rows
      .filter((r) => r.ok && Date.now() - new Date(r.ran_at).getTime() < FRESH_MS)
      .map((r) => r.service_id),
  );
  return Promise.all(providers.filter((p) => !fresh.has(p.id)).map((p) => syncService(p.id)));
}

export function startSchedule(minutes) {
  const tick = (run) =>
    run()
      .then(() => pool.query('DELETE FROM sync_runs WHERE ran_at < NOW() - INTERVAL 14 DAY'))
      .catch((err) => console.error('sync failed:', err.message));
  setTimeout(() => tick(syncStale), 2000);
  setInterval(() => tick(syncAll), minutes * 60_000).unref();
}
