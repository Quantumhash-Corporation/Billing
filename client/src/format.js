/** CSS colour of a service's series; the values live in styles.css so they follow the theme. */
export const seriesColor = (id) => `var(--series-${id}, var(--cobalt))`;

export function money(value, currency = 'USD') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  // Sub-dollar amounts keep extra decimals so small API costs don't all read "$0.00".
  const digits = n !== 0 && Math.abs(n) < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function count(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
}

/** 'YYYY-MM-DD' -> '6 Oct' (with the year when it is not this year) */
export function shortDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

export function dateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ago(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export const days = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

export const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
