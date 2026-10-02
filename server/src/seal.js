import crypto from 'node:crypto';
import { config } from './env.js';

// Secrets kept in the database (a provider login session) are encrypted with a key
// derived from SESSION_SECRET, so a copy of the database alone does not expose them.
const key = () => crypto.createHash('sha256').update(`provider-state:${config.sessionSecret}`).digest();

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

/** Returns null when the value is missing, damaged, or sealed with another SESSION_SECRET. */
export function unseal(sealed) {
  try {
    const [iv, tag, data] = String(sealed)
      .split('.')
      .map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
