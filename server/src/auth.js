import crypto from 'node:crypto';
import { config } from './env.js';

const COOKIE = 'bd_session';
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60_000;

const sign = (value) =>
  crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

// Compare digests so the comparison is constant-time whatever the input lengths are.
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

function readCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export function isSignedIn(req) {
  const token = readCookie(req);
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac || !safeEqual(mac, sign(expires))) return false;
  return Number(expires) > Date.now();
}

function cookie(value, maxAgeSeconds) {
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(config.cookieSecure ? ['Secure'] : []),
  ].join('; ');
}

const attempts = new Map();

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const now = Date.now();
  // forget finished lockouts, so a flood of addresses cannot grow this map without bound
  if (attempts.size > 1000) {
    for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
  }
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function login(req, res) {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, config.dashboardPassword)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'That password is not right.' });
  }
  attempts.delete(ip);
  const expires = String(Date.now() + SESSION_DAYS * 86400_000);
  res.setHeader('Set-Cookie', cookie(`${expires}.${sign(expires)}`, SESSION_DAYS * 86400));
  return res.json({ signedIn: true });
}

export function logout(_req, res) {
  res.setHeader('Set-Cookie', cookie('', 0));
  res.json({ signedIn: false });
}

export function requireSession(req, res, next) {
  if (isSignedIn(req)) return next();
  return res.status(401).json({ error: 'Sign in to continue.' });
}

/** Reject state-changing requests that come from another site. */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Browsers state where a request came from; unlike Host, this survives a reverse proxy.
  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
    return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      // fall through to the rejection below
    }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  return next();
}
