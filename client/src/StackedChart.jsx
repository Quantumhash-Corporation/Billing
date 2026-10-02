import { useState } from 'react';
import { useWidth } from './CostChart.jsx';
import { money, seriesColor, shortDay } from './format.js';

const H = 250;
const PAD = { top: 10, right: 8, bottom: 26, left: 52 };
const GAP = 2; // surface gap between stacked segments

// Round the axis top up to 1, 2 or 5 times a power of ten.
function niceMax(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

export default function StackedChart({ days, services }) {
  const [active, setActive] = useState(null);
  // drawn at the container's real width, so labels keep their size on any screen
  const [ref, width] = useWidth();
  const W = width || 960;

  // Stacking only makes sense within one currency; use the one most services share.
  const withCost = services.filter((s) => s.costs.some((c) => c > 0));
  const currency = withCost[0]?.currency || 'USD';
  const series = withCost.filter((s) => s.currency === currency);

  if (!series.length) {
    return <p className="empty">No cost recorded yet. It appears here after the first sync with usage.</p>;
  }

  const totals = days.map((_, i) => series.reduce((sum, s) => sum + s.costs[i], 0));
  const max = niceMax(Math.max(...totals));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / days.length;
  const barW = Math.min(34, Math.max(3, step - 6));
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const sumOf = (s) => (active != null ? s.costs[active] : s.costs.reduce((a, b) => a + b, 0));
  const grand = active != null ? totals[active] : totals.reduce((a, b) => a + b, 0);

  return (
    <figure className="stacked" ref={ref}>
      <figcaption>
        <span className="stacked-when">{active != null ? shortDay(days[active]) : 'Last 30 days'}</span>
        <strong>{money(grand, currency)}</strong>
        <ul className="legend">
          {series.map((s) => (
            <li key={s.id}>
              <span className="swatch" style={{ '--series': seriesColor(s.id) }} aria-hidden="true" />
              {s.name} <span className="num">{money(sumOf(s), currency)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily cost per service for the last 30 days, ${money(totals.reduce((a, b) => a + b, 0), currency)} in total`}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {money(t, currency)}
            </text>
          </g>
        ))}
        {days.map((day, i) => {
          const x = PAD.left + i * step + (step - barW) / 2;
          let base = 0;
          return (
            <g key={day} onMouseEnter={() => setActive(i)} opacity={active == null || active === i ? 1 : 0.45}>
              <rect x={PAD.left + i * step} y={PAD.top} width={step} height={innerH} fill="transparent" />
              {series.map((s) => {
                const value = s.costs[i];
                if (value <= 0) return null;
                const top = y(base + value);
                const height = Math.max(1, y(base) - top - (base > 0 ? GAP : 0));
                base += value;
                return <rect key={s.id} x={x} y={top} width={barW} height={height} rx="2" style={{ fill: seriesColor(s.id) }} />;
              })}
            </g>
          );
        })}
        {[0, Math.floor(days.length / 2), days.length - 1].map((i) => (
          <text
            key={i}
            className="tick"
            x={PAD.left + i * step + step / 2}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
          >
            {shortDay(days[i])}
          </text>
        ))}
      </svg>
    </figure>
  );
}
