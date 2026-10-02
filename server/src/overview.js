import { computeBalance, dailyAverage, dayStr, lastDays, renewalCycle } from './balance.js';
import { pool } from './db.js';
import { config } from './env.js';
import { providerById, providers } from './providers/index.js';
import { missingKeys } from './sync.js';

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function groupBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row[key])) out.set(row[key], []);
    out.get(row[key]).push(row);
  }
  return out;
}

function summarise(provider, service, usage, ledger, extra, lastRun, today) {
  const dailyCost = new Map(usage.map((u) => [u.day, Number(u.cost)]));
  const month = today.slice(0, 7);
  const monthRows = usage.filter((u) => u.day.startsWith(month));
  const sum = (rows, field) => rows.reduce((s, r) => s + Number(r[field]), 0);

  // A balance the provider reports itself beats one worked out from manual entries.
  const reported = extra?.reportedBalance;
  let balance = null;
  if (service.kind === 'prepaid') {
    balance = reported
      ? { balance: reported.amount, capacity: reported.capacity }
      : computeBalance(ledger, dailyCost);
  }
  const renewal = renewalCycle(service.renewal_anchor, service.renewal_interval, today);
  const average = dailyAverage(dailyCost, 7, today);

  let fill = null;
  let status = 'unknown';
  let lowAt = null;
  if (service.kind === 'prepaid') {
    if (balance) {
      lowAt = service.low_balance ?? balance.capacity * 0.2;
      fill = balance.capacity > 0 ? Math.min(1, Math.max(0, balance.balance / balance.capacity)) : 0;
      status = balance.balance <= 0 ? 'empty' : balance.balance <= lowAt ? 'low' : 'ok';
    }
  } else if (renewal) {
    fill = Math.min(1, Math.max(0, renewal.daysLeft / renewal.cycleDays));
    status = renewal.daysLeft <= 3 ? 'due' : 'ok';
  }

  const missing = missingKeys(provider);
  return {
    id: service.id,
    name: service.name,
    kind: service.kind,
    currency: service.currency,
    planName: service.plan_name,
    planPrice: service.plan_price,
    includedUsage: service.included_usage,
    connected: missing.length === 0,
    missingKeys: missing,
    balance: balance?.balance ?? null,
    balanceSource: reported ? 'provider' : 'manual',
    canReconnect: typeof provider.reconnect === 'function',
    capacity: balance?.capacity ?? null,
    lowAt,
    runwayDays: balance && average > 0 ? Math.max(0, balance.balance) / average : null,
    renewal,
    fill,
    status,
    todayCost: dailyCost.get(today) || 0,
    monthCost: extra?.periodCost ?? sum(monthRows, 'cost'),
    monthUnits: sum(monthRows, 'units'),
    unitLabel: provider.unitLabel,
    windows: extra?.windows || null,
    lastSync: lastRun
      ? { at: new Date(lastRun.ran_at).toISOString(), ok: !!lastRun.ok, message: lastRun.message }
      : null,
  };
}

async function load(serviceId) {
  const where = serviceId ? 'WHERE service_id = ?' : '';
  const args = serviceId ? [serviceId] : [];
  const [[services], [usage], [ledger], [states], [runs]] = await Promise.all([
    pool.query(`SELECT * FROM services ${serviceId ? 'WHERE id = ?' : ''}`, args),
    pool.query(`SELECT service_id, day, cost, units, requests, breakdown FROM usage_daily ${where}`, args),
    pool.query(`SELECT * FROM ledger ${where} ORDER BY happened_at DESC, id DESC`, args),
    pool.query(`SELECT service_id, v FROM provider_state ${where ? `${where} AND` : 'WHERE'} k = 'extra'`, args),
    pool.query(
      `SELECT r.* FROM sync_runs r
         JOIN (SELECT MAX(id) AS id FROM sync_runs ${where} GROUP BY service_id) m ON m.id = r.id`,
      args,
    ),
  ]);
  return {
    services: new Map(services.map((s) => [s.id, s])),
    usage: groupBy(usage, 'service_id'),
    ledger: groupBy(ledger, 'service_id'),
    extra: new Map(states.map((s) => [s.service_id, parseJson(s.v)])),
    runs: new Map(runs.map((r) => [r.service_id, r])),
  };
}

export async function buildOverview() {
  const today = dayStr();
  const data = await load();
  const days = lastDays(30, today);
  const services = providers
    .filter((p) => data.services.has(p.id))
    .map((p) => {
      const usage = data.usage.get(p.id) || [];
      const costByDay = new Map(usage.map((u) => [u.day, Number(u.cost)]));
      return {
        ...summarise(
          p,
          data.services.get(p.id),
          usage,
          data.ledger.get(p.id) || [],
          data.extra.get(p.id),
          data.runs.get(p.id),
          today,
        ),
        // cost per day, lined up with `days`, for the charts on the overview
        costs: days.map((day) => costByDay.get(day) || 0),
      };
    });
  return {
    generatedAt: new Date().toISOString(),
    today,
    days,
    syncIntervalMinutes: config.syncIntervalMinutes,
    services,
  };
}

export async function buildDetail(serviceId) {
  const provider = providerById.get(serviceId);
  if (!provider) return null;
  const today = dayStr();
  const data = await load(serviceId);
  const service = data.services.get(serviceId);
  if (!service) return null;
  const usage = data.usage.get(serviceId) || [];
  const ledger = data.ledger.get(serviceId) || [];
  const extra = data.extra.get(serviceId);

  const byDay = new Map(usage.map((u) => [u.day, u]));
  const window = lastDays(30, today);
  const daily = window.map((day) => ({
    day,
    cost: Number(byDay.get(day)?.cost || 0),
    units: Number(byDay.get(day)?.units || 0),
    requests: Number(byDay.get(day)?.requests || 0),
  }));

  // Providers that only report a running total hand over a ready-made breakdown;
  // for the rest it is added up from the last 30 daily rows.
  let breakdown = extra?.breakdown || null;
  let breakdownScope = extra?.breakdownScope || 'this billing period';
  if (!breakdown) {
    breakdownScope = 'last 30 days';
    const merged = {};
    for (const day of window) {
      const parts = parseJson(byDay.get(day)?.breakdown);
      if (!parts) continue;
      for (const [label, v] of Object.entries(parts)) {
        const entry = (merged[label] ||= {});
        for (const [field, n] of Object.entries(v)) entry[field] = (entry[field] || 0) + Number(n);
      }
    }
    breakdown = Object.keys(merged).length ? merged : null;
  }

  return {
    summary: summarise(provider, service, usage, ledger, extra, data.runs.get(serviceId), today),
    settings: {
      kind: service.kind,
      planName: service.plan_name,
      planPrice: service.plan_price,
      renewalAnchor: service.renewal_anchor,
      renewalInterval: service.renewal_interval,
      includedUsage: service.included_usage,
      unitRate: service.unit_rate,
      lowBalance: service.low_balance,
    },
    usesUnitRate: provider.unitRate != null,
    daily,
    breakdown,
    breakdownScope,
    ledger: ledger.map((e) => ({
      id: e.id,
      kind: e.kind,
      amount: Number(e.amount),
      at: new Date(e.happened_at).toISOString(),
      note: e.note,
    })),
  };
}
