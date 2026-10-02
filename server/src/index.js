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

// Only our own scripts run; styles and fonts may also come from Google Fonts.
// 'unsafe-inline' for styles covers the style attributes React sets on chart elements.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '20kb' }));
// balances and keys' status must never sit in a browser or proxy cache
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
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
  if (config.production && !config.cookieSecure) {
    console.warn(
      'Warning: COOKIE_SECURE is off. Serve the dashboard over https and set COOKIE_SECURE=1, or the password and login cookie travel unencrypted.',
    );
  }
  if (config.db.ssl && !config.db.ca) {
    console.warn(
      'Warning: the database connection is encrypted but the server certificate is not verified. Set DB_SSL_CA to the CA file to verify it.',
    );
  }
  startSchedule(config.syncIntervalMinutes);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => pool.end().finally(() => process.exit(0)));
}
