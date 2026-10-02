import { useState } from 'react';
import { api } from './api.js';
import CostChart from './CostChart.jsx';
import { ago, count, days, money, seriesColor, shortDay } from './format.js';

const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

function Ring({ fill, status, big, small }) {
  const known = fill != null;
  return (
    <div className={`ring status-${status}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className={`ring-track${known ? '' : ' is-unknown'}`} cx="50" cy="50" r={R} />
        {known && fill > 0 && (
          <circle
            className="ring-value"
            cx="50"
            cy="50"
            r={R}
            strokeDasharray={`${Math.max(0.02, fill) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 50 50)"
          />
        )}
      </svg>
      <div className="ring-text">
        <strong>{big}</strong>
        <span>{small}</span>
      </div>
    </div>
  );
}

function connection(service) {
  if (!service.connected) return { tone: 'off', text: 'No API key' };
  if (!service.lastSync) return { tone: 'wait', text: 'Waiting for first sync' };
  if (!service.lastSync.ok) return { tone: 'bad', text: 'Sync failed' };
  return { tone: 'ok', text: `Synced ${ago(service.lastSync.at)}` };
}

function headline(service) {
  const c = service.currency;
  if (service.kind === 'prepaid') {
    if (service.balance == null) {
      return { ring: ['?', 'not set'], title: 'Balance not set', line: 'Enter what is left today to start tracking.' };
    }
    const runway =
      service.runwayDays != null ? `About ${days(Math.floor(service.runwayDays))} left at this pace` : null;
    return {
      ring: [`${Math.round(service.fill * 100)}%`, 'left'],
      title: `${money(service.balance, c)} left`,
      line: [`of ${money(service.capacity, c)}`, runway].filter(Boolean).join('. '),
    };
  }
  if (!service.renewal) {
    return { ring: ['?', 'no date'], title: 'Renewal date not set', line: 'Add it to see the countdown.' };
  }
  const n = service.renewal.daysLeft;
  const price = service.planPrice != null ? `, ${money(service.planPrice, c)}` : '';
  return {
    ring: [String(n), n === 1 ? 'day' : 'days'],
    title: n === 0 ? 'Renews today' : `Renews in ${days(n)}`,
    line: `On ${shortDay(service.renewal.next)}${price}`,
  };
}

const FLAG = { low: 'Running low', empty: 'Out of credit', due: 'Renews soon' };

// Signs the server in to the provider again and stores the fresh session.
function ReconnectButton({ service, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function reconnect() {
    setBusy(true);
    setError(null);
    try {
      const { overview } = await api.reconnect(service.id);
      onDone(overview);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn small" onClick={reconnect} disabled={busy}>
        {busy ? 'Signing in…' : 'Refresh login'}
        <span className="sr-only"> for {service.name}</span>
      </button>
      {error && (
        <p className="form-error card-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export default function ServiceCard({ service, days: dayList, onManage, onOverview }) {
  const color = seriesColor(service.id);
  const conn = connection(service);
  const head = headline(service);
  const daily = dayList.map((day, i) => ({ day, cost: service.costs[i] }));
  const hasCost = service.costs.some((c) => c > 0);
  const needsSetup = service.kind === 'prepaid' ? service.balance == null : !service.renewal;
  // a prepaid service can also carry a renewal date; show it as a footnote
  const renewalNote =
    service.kind === 'prepaid' && service.renewal
      ? `Renews ${shortDay(service.renewal.next)} (${days(service.renewal.daysLeft)})`
      : null;

  return (
    <article className="card" style={{ '--series': color }}>
      <header className="card-head">
        <h2>
          <span className="swatch" aria-hidden="true" />
          {service.name}
        </h2>
        <span className={`chip chip-${conn.tone}`} title={service.lastSync?.message || undefined}>
          {conn.text}
        </span>
      </header>

      <div className="card-gauge">
        <Ring fill={service.fill} status={service.status} big={head.ring[0]} small={head.ring[1]} />
        <div className="card-reading">
          <p className="card-title">{head.title}</p>
          <p className="card-line">{head.line}</p>
          {FLAG[service.status] && <p className={`flag flag-${service.status}`}>{FLAG[service.status]}</p>}
        </div>
      </div>

      <div className="card-chart">
        {hasCost ? (
          <CostChart daily={daily} currency={service.currency} color={color} compact />
        ) : service.windows?.length ? (
          <div className="windows">
            {service.windows.map((w) => (
              <div key={w.name} className="meter">
                <span>{w.label}</span>
                <span className="meter-track">
                  <span className="meter-fill" style={{ width: `${Math.round(w.used * 100)}%` }} />
                </span>
                <span className="num">{Math.round(w.used * 100)}% used</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-empty">
            {service.connected ? 'No cost recorded in the last 30 days.' : 'Add the API key to see usage here.'}
          </p>
        )}
      </div>

      <dl className="card-stats">
        <div>
          <dt>Today</dt>
          <dd>{money(service.todayCost, service.currency)}</dd>
        </div>
        <div>
          <dt>This month</dt>
          <dd>{money(service.monthCost, service.currency)}</dd>
        </div>
        {service.unitLabel && (
          <div>
            <dt>{service.unitLabel}</dt>
            <dd>{count(service.monthUnits)}</dd>
          </div>
        )}
      </dl>

      <footer className="card-foot">
        <span className="muted">{renewalNote}</span>
        {service.canReconnect && <ReconnectButton service={service} onDone={onOverview} />}
        <button type="button" className={`btn small${needsSetup ? ' primary' : ''}`} onClick={() => onManage(service.id)}>
          {needsSetup ? (service.kind === 'prepaid' ? 'Set balance' : 'Set renewal date') : 'Details'}
          <span className="sr-only"> for {service.name}</span>
        </button>
      </footer>
    </article>
  );
}
