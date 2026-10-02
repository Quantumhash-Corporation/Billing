import { useEffect, useState } from 'react';
import { money, shortDay } from './format.js';

const PAD = { top: 12, right: 4, bottom: 24, left: 4 };

/** Width of an element in CSS pixels, kept up to date as it resizes (0 until measured). */
export function useWidth() {
  // A callback ref, so measuring starts whenever the element appears, not only on mount.
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

/** Daily cost bars for one service. `compact` is the shorter version used on cards. */
export default function CostChart({ daily, currency, color, compact = false }) {
  const [active, setActive] = useState(null);
  // Drawn at the container's real width, so one unit is one pixel and labels keep their size.
  const [ref, width] = useWidth();
  const W = width || (compact ? 340 : 640);
  const H = compact ? 130 : 190;
  const max = Math.max(...daily.map((d) => d.cost));
  const total = daily.reduce((sum, d) => sum + d.cost, 0);

  if (max <= 0) {
    return <p className="empty">No cost recorded in the last 30 days.</p>;
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / daily.length;
  const barW = Math.min(22, Math.max(2, step - (compact ? 3 : 5)));
  const shown = active != null ? daily[active] : null;

  return (
    <figure className="chart" ref={ref} style={color ? { '--series': color } : undefined}>
      <figcaption>
        {shown ? (
          <>
            <strong>{money(shown.cost, currency)}</strong> on {shortDay(shown.day)}
          </>
        ) : (
          <>
            <strong>{money(total, currency)}</strong> over the last 30 days
          </>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily cost for the last 30 days, ${money(total, currency)} in total`}
        onMouseLeave={() => setActive(null)}
      >
        <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
        {daily.map((d, i) => {
          const h = d.cost > 0 ? Math.max(2, (d.cost / max) * innerH) : 0;
          const x = PAD.left + i * step + (step - barW) / 2;
          return (
            <g key={d.day} onMouseEnter={() => setActive(i)}>
              {/* full-height hit area so short bars are still easy to point at */}
              <rect x={PAD.left + i * step} y={PAD.top} width={step} height={innerH} fill="transparent" />
              <rect
                className={`bar${active === i ? ' is-active' : ''}`}
                x={x}
                y={H - PAD.bottom - h}
                width={barW}
                height={h}
                rx="3"
              />
            </g>
          );
        })}
        {[0, Math.floor(daily.length / 2), daily.length - 1].map((i) => (
          <text
            key={i}
            className="tick"
            x={PAD.left + i * step + step / 2}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}
          >
            {shortDay(daily[i].day)}
          </text>
        ))}
      </svg>
    </figure>
  );
}
