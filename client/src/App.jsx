import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Detail from './Detail.jsx';
import { ago, days, inDays, money, shortDay } from './format.js';
import Login from './Login.jsx';
import ServiceCard from './ServiceCard.jsx';
import StackedChart from './StackedChart.jsx';

const REFRESH_MS = 30_000;

// Add up amounts per currency: "$312.40" or "$300.00 + €12.00".
function totals(services, field) {
  const sums = new Map();
  for (const s of services) {
    if (s[field] == null) continue;
    sums.set(s.currency, (sums.get(s.currency) || 0) + Number(s[field]));
  }
  return [...sums].map(([currency, value]) => money(value, currency)).join(' + ');
}

function Summary({ services, children }) {
  const prepaid = services.filter((s) => s.kind === 'prepaid');
  const tracked = prepaid.filter((s) => s.balance != null);
  const renewals = services.filter((s) => s.renewal).sort((a, b) => a.renewal.daysLeft - b.renewal.daysLeft);
  const next = renewals[0];

  const alerts = [];
  for (const s of services) {
    if (s.status === 'empty') alerts.push({ id: `${s.id}-empty`, tone: 'bad', text: `${s.name} has run out of credit.` });
    if (s.status === 'low') {
      const runway = s.runwayDays != null ? `, about ${days(Math.floor(s.runwayDays))} at this pace` : '';
      alerts.push({ id: `${s.id}-low`, tone: 'warn', text: `${s.name} is low: ${money(s.balance, s.currency)} left${runway}.` });
    }
    if (s.status === 'due') {
      alerts.push({ id: `${s.id}-due`, tone: 'warn', text: `${s.name} renews ${inDays(s.renewal.daysLeft)}.` });
    }
    if (s.connected && s.lastSync && !s.lastSync.ok) {
      alerts.push({ id: `${s.id}-sync`, tone: 'bad', text: `${s.name} could not sync: ${s.lastSync.message}` });
    }
  }

  return (
    <>
      {alerts.length > 0 && (
        <ul className="alerts">
          {alerts.map((a) => (
            <li key={a.id} className={`alert alert-${a.tone}`}>
              {a.text}
            </li>
          ))}
        </ul>
      )}
      <div className="top">
        {children}
        <section className="tiles" aria-label="Summary">
        <div className="tile">
          <p className="tile-label">Balance left</p>
          <p className="tile-value">{tracked.length ? totals(tracked, 'balance') : 'Not set'}</p>
          <p className="tile-sub">
            {tracked.length} of {prepaid.length} prepaid services tracked
          </p>
        </div>
        <div className="tile">
          <p className="tile-label">Usage this month</p>
          <p className="tile-value">{totals(services, 'monthCost') || money(0)}</p>
          <p className="tile-sub">{totals(services, 'todayCost') || money(0)} today</p>
        </div>
        <div className="tile">
          <p className="tile-label">Next renewal</p>
          <p className="tile-value">{next ? `${next.name} ${inDays(next.renewal.daysLeft)}` : 'No dates yet'}</p>
          <p className="tile-sub">
            {next
              ? `${shortDay(next.renewal.next)}${next.planPrice != null ? `, ${money(next.planPrice, next.currency)}` : ''}`
              : 'Add renewal dates on the cards below'}
          </p>
        </div>
        </section>
      </div>
    </>
  );
}

function ManageDialog({ id, stamp, onClose, onChanged, onError }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="manage"
      onClose={onClose}
      // a click on the backdrop lands on the dialog element itself
      onClick={(event) => event.target === ref.current && ref.current.close()}
    >
      <button type="button" className="btn small manage-close" onClick={() => ref.current.close()}>
        Close
      </button>
      <Detail id={id} stamp={stamp} onChanged={onChanged} onError={onError} />
    </dialog>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('bd-theme', next);
    } catch {
      // storage can be blocked; the choice then lasts until the page is reloaded
    }
    setTheme(next);
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className="btn icon" onClick={toggle} aria-label={label} title={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

const ICONS = {
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.3L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.3L20 15" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  signOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
};

function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function every(minutes) {
  if (minutes % 60 === 0) return minutes === 60 ? 'every hour' : `every ${minutes / 60} hours`;
  return `every ${minutes} min`;
}

export default function App() {
  const [signedIn, setSignedIn] = useState(null);
  const [overview, setOverview] = useState(null);
  const [managing, setManaging] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const fail = useCallback((err) => {
    if (err.status === 401) setSignedIn(false);
    else setError(err.message);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.overview());
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    api
      .session()
      .then((s) => setSignedIn(s.signedIn))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!signedIn) return undefined;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [signedIn, refresh]);

  async function syncNow() {
    setSyncing(true);
    try {
      const { overview: fresh } = await api.sync();
      setOverview(fresh);
      setError(null);
    } catch (err) {
      fail(err);
    } finally {
      setSyncing(false);
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setOverview(null);
    setManaging(null);
    setSignedIn(false);
  }

  if (signedIn === false) return <Login onSignedIn={() => setSignedIn(true)} />;

  const services = overview?.services || [];
  const lastSyncs = services.map((s) => s.lastSync?.at).filter(Boolean).sort();

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="brand">Billing desk</h1>
        <div className="topbar-actions">
          {overview && (
            <span className="muted">
              Auto-sync {every(overview.syncIntervalMinutes)}
              {lastSyncs.length > 0 && `, last ${ago(lastSyncs.at(-1))}`}
            </span>
          )}
          <button
            type="button"
            className={`btn icon${syncing ? ' is-busy' : ''}`}
            onClick={syncNow}
            disabled={syncing || !overview}
            aria-label={syncing ? 'Syncing' : 'Sync now'}
            title={syncing ? 'Syncing…' : 'Sync now'}
          >
            <Icon name="sync" />
          </button>
          <ThemeToggle />
          <button type="button" className="btn icon" onClick={signOut} aria-label="Sign out" title="Sign out">
            <Icon name="signOut" />
          </button>
        </div>
      </header>

      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      {!overview ? (
        !error && <p className="muted loading">Loading your services…</p>
      ) : (
        <>
          <Summary services={services}>
            <section className="panel" aria-label="Daily cost across services">
              <h2>Daily cost across services</h2>
              <StackedChart days={overview.days} services={services} />
            </section>
          </Summary>
          <section className="cards" aria-label="Services">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                days={overview.days}
                onManage={setManaging}
                onOverview={setOverview}
              />
            ))}
          </section>
          {managing && (
            <ManageDialog
              id={managing}
              stamp={overview.generatedAt}
              onClose={() => setManaging(null)}
              onChanged={refresh}
              onError={fail}
            />
          )}
        </>
      )}
    </div>
  );
}
