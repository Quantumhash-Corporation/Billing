import { addDays, dayStr } from '../balance.js';
import { getJson, mapLimit } from './http.js';

// AssemblyAI has no usage or balance endpoint. What it does expose is every transcript
// and its audio length, so cost is rebuilt as: hours transcribed x your hourly rate.
// Streaming sessions do not appear in the transcript list and are not counted.
const WINDOW_DAYS = 35;
const MAX_PAGES = 15;
const MAX_DETAILS_PER_SYNC = 150;

export default {
  id: 'assemblyai',
  name: 'AssemblyAI',
  kind: 'prepaid',
  keys: ['ASSEMBLYAI_API_KEY'],
  unitRate: 0.15,
  unitLabel: 'audio hours',

  async sync({ key, service, pool }) {
    const base = (key('ASSEMBLYAI_BASE_URL') || 'https://api.assemblyai.com').replace(/\/$/, '');
    const headers = { Authorization: key('ASSEMBLYAI_API_KEY') };
    const cutoff = addDays(dayStr(), -WINDOW_DAYS);

    // Newest first; prev_url walks back in time.
    const listed = [];
    let query = 'limit=200&status=completed';
    for (let page = 0; page < MAX_PAGES && query; page += 1) {
      const body = await getJson(`${base}/v2/transcript?${query}`, headers);
      const items = body.transcripts || [];
      listed.push(...items);
      const oldest = items.at(-1)?.created;
      const prev = body.page_details?.prev_url;
      // Only the query string of prev_url is reused, so requests never leave `base`.
      query = prev && items.length && oldest.slice(0, 10) >= cutoff ? new URL(prev, base).search.slice(1) : null;
    }
    const recent = listed.filter((t) => t.created && t.created.slice(0, 10) >= cutoff);

    const [known] = await pool.query('SELECT id FROM assemblyai_transcripts WHERE created >= ?', [
      `${cutoff} 00:00:00`,
    ]);
    const have = new Set(known.map((r) => r.id));
    const missing = recent.filter((t) => !have.has(t.id));
    const batch = missing.slice(0, MAX_DETAILS_PER_SYNC);

    const details = await mapLimit(batch, 6, async (t) => {
      const full = await getJson(`${base}/v2/transcript/${encodeURIComponent(t.id)}`, headers);
      return [t.id, new Date(t.created), Number(full.audio_duration) || 0];
    });
    if (details.length) {
      await pool.query('INSERT IGNORE INTO assemblyai_transcripts (id, created, duration_sec) VALUES ?', [
        details,
      ]);
    }

    const rate = Number(service.unit_rate) || 0;
    const [rows] = await pool.query(
      `SELECT DATE(created) AS day, SUM(duration_sec) AS seconds, COUNT(*) AS n
         FROM assemblyai_transcripts WHERE created >= ? GROUP BY DATE(created)`,
      [`${cutoff} 00:00:00`],
    );
    const days = rows.map((r) => {
      const hours = Number(r.seconds) / 3600;
      return { day: r.day, cost: hours * rate, units: hours, requests: Number(r.n), breakdown: null };
    });

    const left = missing.length - batch.length;
    return {
      days,
      note: left > 0 ? `Catching up: ${left} older transcripts still to read` : null,
    };
  },
};
