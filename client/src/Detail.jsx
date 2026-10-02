import { useEffect, useState } from 'react';
import { api } from './api.js';
import CostChart from './CostChart.jsx';
import { ago, count, dateTime, days, inDays, money, seriesColor, shortDay } from './format.js';

function statusSentence(s) {
  if (s.kind === 'prepaid') {
    if (s.balance == null) return 'No balance entered yet. Enter what is left today and it is tracked from here on.';
    const base = `${money(s.balance, s.currency)} left of ${money(s.capacity, s.currency)}.`;
    if (s.runwayDays == null) return base;
    return `${base} At the last week's pace that lasts about ${days(Math.floor(s.runwayDays))}.`;
  }
  if (!s.renewal) return 'No renewal date entered yet. Add it under Plan and renewal.';
  const price = s.planPrice != null ? ` for ${money(s.planPrice, s.currency)}` : '';
  return `Renews ${inDays(s.renewal.daysLeft)}, on ${shortDay(s.renewal.next)}${price}.`;
}

function Connection({ summary, syncing, onSync }) {
  let text;
  let tone = 'plain';
  if (!summary.connected) {
    tone = 'warn';
    text = `Add ${summary.missingKeys.join(' and ')} to the .env file and restart the server to pull usage and cost. Balance and renewal tracking work without it.`;
  } else if (!summary.lastSync) {
    text = 'Connected. Waiting for the first sync.';
  } else if (!summary.lastSync.ok) {
    tone = 'bad';
    text = `Last sync failed ${ago(summary.lastSync.at)}: ${summary.lastSync.message}`;
  } else {
    text = `Synced ${ago(summary.lastSync.at)}.${summary.lastSync.message ? ` ${summary.lastSync.message}` : ''}`;
  }
  return (
    <p className={`connection tone-${tone}`}>
      <span>{text}</span>
      {summary.connected && (
        <button type="button" className="btn small" onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync this service'}
        </button>
      )}
    </p>
  );
}

function Breakdown({ breakdown, scope, currency, unitLabel }) {
  const rows = Object.entries(breakdown).sort(
    ([, a], [, b]) => (b.cost ?? b.units ?? 0) - (a.cost ?? a.units ?? 0),
  );
  const has = (field) => rows.some(([, v]) => v[field] != null);
  return (
    <div className="block">
      <h3>Where it went, {scope}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
            {has('cost') && <th scope="col" className="num">Cost</th>}
            {has('units') && <th scope="col" className="num">{unitLabel || 'Units'}</th>}
            {has('requests') && <th scope="col" className="num">Requests</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map(([label, v]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {has('cost') && <td className="num">{money(v.cost, currency)}</td>}
              {has('units') && <td className="num">{count(v.units)}</td>}
              {has('requests') && <td className="num">{count(v.requests)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceForm({ id, summary, ledger, apply }) {
  const [kind, setKind] = useState(summary.balance == null ? 'set' : 'topup');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      apply(await api.addEntry(id, { kind, amount, note }));
      setAmount('');
      setNote('');
      setKind('topup');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry) {
    const what = entry.kind === 'set' ? 'balance entry' : 'top-up';
    if (!window.confirm(`Remove this ${what} of ${money(entry.amount, summary.currency)}?`)) return;
    try {
      apply(await api.removeEntry(id, entry.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="block">
      <h3>Balance</h3>
      <form onSubmit={submit} className="stack">
        <fieldset className="choice">
          <legend className="sr-only">What are you recording?</legend>
          <label>
            <input type="radio" name="kind" checked={kind === 'set'} onChange={() => setKind('set')} />
            Balance right now
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === 'topup'} onChange={() => setKind('topup')} />
            Money I just added
          </label>
        </fieldset>
        <div className="row">
          <label className="field">
            <span>Amount ({summary.currency})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field grow">
            <span>Note (optional)</span>
            <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : kind === 'set' ? 'Set balance' : 'Add top-up'}
        </button>
      </form>

      {ledger.length > 0 && (
        <ul className="ledger">
          {ledger.map((entry) => (
            <li key={entry.id}>
              <span className="ledger-what">
                {entry.kind === 'set' ? 'Balance set to' : 'Top-up of'}{' '}
                <strong>{money(entry.amount, summary.currency)}</strong>
                <small>
                  {dateTime(entry.at)}
                  {entry.note ? `, ${entry.note}` : ''}
                </small>
              </span>
              <button type="button" className="btn quiet small" onClick={() => remove(entry)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const blank = (v) => (v == null ? '' : String(v));

function SettingsForm({ id, settings, summary, usesUnitRate, apply }) {
  const [form, setForm] = useState(() => ({
    kind: settings.kind,
    planName: blank(settings.planName),
    planPrice: blank(settings.planPrice),
    renewalAnchor: blank(settings.renewalAnchor),
    renewalInterval: settings.renewalInterval,
    includedUsage: blank(settings.includedUsage),
    unitRate: blank(settings.unitRate),
    lowBalance: blank(settings.lowBalance),
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const set = (field) => (event) => {
    setMessage(null);
    setForm((f) => ({ ...f, [field]: event.target.value }));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      apply(await api.saveSettings(id, form));
      setMessage({ ok: true, text: 'Settings saved' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const unit = summary.unitLabel ? summary.unitLabel.replace(/s$/, '') : 'unit';

  return (
    <form onSubmit={submit} className="block stack">
      <h3>Plan and renewal</h3>
      <div className="row">
        <label className="field grow">
          <span>How you pay</span>
          <select value={form.kind} onChange={set('kind')}>
            <option value="prepaid">Prepaid credit</option>
            <option value="subscription">Subscription</option>
          </select>
        </label>
        <label className="field grow">
          <span>Plan name</span>
          <input type="text" maxLength={80} value={form.planName} onChange={set('planName')} />
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          <span>A renewal date</span>
          <input type="date" value={form.renewalAnchor} onChange={set('renewalAnchor')} />
        </label>
        <label className="field grow">
          <span>Repeats</span>
          <select value={form.renewalInterval} onChange={set('renewalInterval')}>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          <span>Plan price ({summary.currency})</span>
          <input type="number" min="0" step="0.01" value={form.planPrice} onChange={set('planPrice')} />
        </label>
        {form.kind === 'prepaid' ? (
          <label className="field grow">
            <span>Warn me below ({summary.currency})</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="20% of balance"
              value={form.lowBalance}
              onChange={set('lowBalance')}
            />
          </label>
        ) : (
          <label className="field grow">
            <span>Usage included ({summary.currency})</span>
            <input type="number" min="0" step="0.01" value={form.includedUsage} onChange={set('includedUsage')} />
          </label>
        )}
      </div>
      {usesUnitRate && (
        <label className="field">
          <span>Price per {unit} ({summary.currency})</span>
          <input type="number" min="0" step="0.0001" value={form.unitRate} onChange={set('unitRate')} />
          <small>
            This service reports {summary.unitLabel}, not money. Cost is worked out from this price, so
            match it to your plan.
          </small>
        </label>
      )}
      {message && (
        <p className={message.ok ? 'form-ok' : 'form-error'} role="status">
          {message.text}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}

export default function Detail({ id, stamp, onChanged, onError }) {
  const [detail, setDetail] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .detail(id)
      .then((d) => live && setDetail(d))
      .catch((err) => live && onError(err));
    return () => {
      live = false;
    };
  }, [id, stamp, onError]);

  if (!detail || detail.summary.id !== id) {
    return (
      <section className="detail">
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const { summary, daily, breakdown, breakdownScope, ledger, settings, usesUnitRate } = detail;
  const apply = (fresh) => {
    setDetail(fresh);
    onChanged();
  };

  async function syncThis() {
    setSyncing(true);
    try {
      await api.sync(id);
      setDetail(await api.detail(id));
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setSyncing(false);
    }
  }

  const included = summary.includedUsage;

  return (
    <section className="detail" aria-label={`${summary.name} details`}>
      <div className="detail-head">
        <h2>{summary.name}</h2>
        <p className="lead">{statusSentence(summary)}</p>
        <Connection summary={summary} syncing={syncing} onSync={syncThis} />
      </div>

      <div className="detail-main">
        <div className="block">
          <h3>Daily cost</h3>
          <CostChart daily={daily} currency={summary.currency} color={seriesColor(id)} />
          <dl className="figures">
            <div>
              <dt>Today</dt>
              <dd>{money(summary.todayCost, summary.currency)}</dd>
            </div>
            <div>
              <dt>This month</dt>
              <dd>
                {money(summary.monthCost, summary.currency)}
                {included != null && <small> of {money(included, summary.currency)} included</small>}
              </dd>
            </div>
            {summary.unitLabel && (
              <div>
                <dt>{summary.unitLabel} this month</dt>
                <dd>{count(summary.monthUnits)}</dd>
              </div>
            )}
          </dl>
        </div>

        {summary.windows?.length > 0 && (
          <div className="block">
            <h3>Plan usage</h3>
            {summary.windows.map((w) => (
              <div key={w.name} className="meter">
                <span>{w.label}</span>
                <span className="meter-track">
                  <span className="meter-fill" style={{ width: `${Math.round(w.used * 100)}%` }} />
                </span>
                <span className="num">{Math.round(w.used * 100)}% used</span>
              </div>
            ))}
          </div>
        )}

        {breakdown && (
          <Breakdown
            breakdown={breakdown}
            scope={breakdownScope}
            currency={summary.currency}
            unitLabel={summary.unitLabel}
          />
        )}
      </div>

      <div className="detail-side">
        {settings.kind === 'prepaid' && summary.balanceSource === 'provider' && (
          <div className="block">
            <h3>Balance</h3>
            <p className="muted">
              Read from your {summary.name} account on every sync, so there is nothing to enter here.
            </p>
          </div>
        )}
        {settings.kind === 'prepaid' && summary.balanceSource !== 'provider' && (
          <BalanceForm key={`balance-${id}`} id={id} summary={summary} ledger={ledger} apply={apply} />
        )}
        <SettingsForm
          key={`settings-${id}`}
          id={id}
          settings={settings}
          summary={summary}
          usesUnitRate={usesUnitRate}
          apply={apply}
        />
      </div>
    </section>
  );
}
