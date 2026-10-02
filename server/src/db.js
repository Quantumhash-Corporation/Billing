import mysql from 'mysql2/promise';
import { config } from './env.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  // The server presents a self-signed certificate: encrypt, but don't verify the chain.
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 5,
  // Close connections idle for 4 minutes. The database sits behind a router that silently
  // drops connections left idle between syncs; reusing one hangs until it times out.
  maxIdle: 2,
  idleTimeout: 240000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 15000,
  timezone: 'Z',
  dateStrings: ['DATE'],
  decimalNumbers: true,
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS services (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    kind ENUM('prepaid','subscription') NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    plan_name VARCHAR(80) NULL,
    plan_price DECIMAL(12,2) NULL,
    renewal_anchor DATE NULL,
    renewal_interval ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly',
    included_usage DECIMAL(12,2) NULL,
    unit_rate DECIMAL(12,6) NULL,
    low_balance DECIMAL(12,2) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS usage_daily (
    service_id VARCHAR(32) NOT NULL,
    day DATE NOT NULL,
    cost DECIMAL(16,6) NOT NULL DEFAULT 0,
    units DECIMAL(20,4) NOT NULL DEFAULT 0,
    requests BIGINT NOT NULL DEFAULT 0,
    breakdown JSON NULL,
    PRIMARY KEY (service_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id VARCHAR(32) NOT NULL,
    kind ENUM('set','topup') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    day_cost_baseline DECIMAL(16,6) NOT NULL DEFAULT 0,
    happened_at DATETIME NOT NULL,
    note VARCHAR(200) NULL,
    KEY idx_ledger_service (service_id, happened_at)
  )`,
  `CREATE TABLE IF NOT EXISTS provider_state (
    service_id VARCHAR(32) NOT NULL,
    k VARCHAR(64) NOT NULL,
    v JSON NOT NULL,
    PRIMARY KEY (service_id, k)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id VARCHAR(32) NOT NULL,
    ran_at DATETIME NOT NULL,
    ok TINYINT(1) NOT NULL,
    message VARCHAR(500) NULL,
    ms INT NOT NULL DEFAULT 0,
    KEY idx_runs_service (service_id, ran_at)
  )`,
  `CREATE TABLE IF NOT EXISTS assemblyai_transcripts (
    id VARCHAR(64) PRIMARY KEY,
    created DATETIME NOT NULL,
    duration_sec DECIMAL(14,3) NOT NULL DEFAULT 0,
    KEY idx_aai_created (created)
  )`,
];

export async function migrate(providers) {
  for (const sql of SCHEMA) await pool.query(sql);
  for (const p of providers) {
    await pool.query(
      'INSERT IGNORE INTO services (id, name, kind, unit_rate) VALUES (?, ?, ?, ?)',
      [p.id, p.name, p.kind, p.unitRate ?? null],
    );
  }
}

/** Small JSON key/value store each provider uses to remember things between syncs. */
export function stateFor(serviceId) {
  return {
    async get(k) {
      const [rows] = await pool.query(
        'SELECT v FROM provider_state WHERE service_id = ? AND k = ?',
        [serviceId, k],
      );
      if (!rows.length) return null;
      const v = rows[0].v;
      return typeof v === 'string' ? JSON.parse(v) : v;
    },
    async set(k, v) {
      await pool.query(
        `INSERT INTO provider_state (service_id, k, v) VALUES (?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE v = new.v`,
        [serviceId, k, JSON.stringify(v)],
      );
    },
  };
}
