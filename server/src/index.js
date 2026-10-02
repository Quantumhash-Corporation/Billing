import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { migrate, pool } from './db.js';
import { config, rootDir } from './env.js';
import { providers } from './providers/index.js';
import { api } from './routes.js';
import { startSchedule } from './sync.js';

if (!config.dashboardPassword || config.sessionSecret.length < 32) {
  console.error('Set DASHBOARD_PASSWORD and a SESSION_SECRET of 32+ characters in .env, then start again.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use('/api', api);

const dist = path.join(rootDir, 'client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

try {
  await migrate(providers);
} catch (err) {
  console.error(`Could not prepare the database: ${err.message}`);
  process.exit(1);
}

app.listen(config.port, () => {
  console.log(`Billing desk listening on http://localhost:${config.port}`);
  startSchedule(config.syncIntervalMinutes);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => pool.end().finally(() => process.exit(0)));
}
