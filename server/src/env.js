import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const envFile = path.join(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

export const config = {
  port: Number(env.SERVER_PORT) || 4600,
  production: env.NODE_ENV === 'production',
  syncIntervalMinutes: Math.max(1, Number(env.SYNC_INTERVAL_MINUTES) || 60),
  cookieSecure: env.COOKIE_SECURE === '1',
  trustProxy: env.TRUST_PROXY === '1',
  dashboardPassword: env.DASHBOARD_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',
  db: {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 3306,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL !== '0',
  },
};

/** Read a provider key from the environment; empty string when unset. */
export const envKey = (name) => (process.env[name] || '').trim();
