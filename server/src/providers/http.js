/** GET a JSON document; throws a short, key-free message on failure. */
export async function getJson(url, headers = {}, timeoutMs = 25000) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const host = new URL(url).host;
    throw new Error(
      err.name === 'TimeoutError' ? `${host} did not answer in time` : `Could not reach ${host}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? 'the key was rejected — check it in .env'
        : res.status === 429
          ? 'rate limited — will retry on the next sync'
          : text.replace(/\s+/g, ' ').slice(0, 140);
    throw new Error(`${new URL(url).host} answered ${res.status}: ${hint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).host} sent something that is not JSON`);
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Turn a running total (month-to-date, cycle-to-date) into "how much was added since
 * the last sync". The first time a total is seen it counts as zero, so a mid-month
 * install does not dump the whole month onto today.
 */
export async function deltaSince(state, name, period, total) {
  const prev = await state.get(name);
  await state.set(name, { period, total });
  if (!prev) return 0;
  if (prev.period !== period || total < prev.total) return Math.max(0, total);
  return total - prev.total;
}
