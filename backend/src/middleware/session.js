import { randomUUID, createHash } from 'crypto';
import { upsertSession } from '../db/sessions.js';

// Resolves session ID for the request based on header/cookie precedence.
// - Header x-session-id wins over cookie cf_session_id
// - If neither present, generate a UUID and set it as a persistent cookie
export function sessionResolver(req, res, next) {
  let sessionId = req.header('x-session-id');
  if (!sessionId) {
    const cookieHeader = req.header('cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)cf_session_id=([^;]+)/);
    if (match) sessionId = decodeURIComponent(match[1]);
  }
  if (!sessionId) sessionId = randomUUID();

  // Only set cookie if the client didn't send one.
  const cookieHeader = req.header('cookie') || '';
  const hasCookie = /(?:^|;\s*)cf_session_id=([^;]+)/.test(cookieHeader);
  if (!hasCookie) {
    // Persist effectively "forever" (1 year), until user clears site data
    const maxAgeSeconds = 60 * 60 * 24 * 365;
    const expires = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();

    // Add Secure when request is HTTPS (or behind proxy sending x-forwarded-proto)
    const xfProto =
      (typeof req.header === 'function' && req.header('x-forwarded-proto')) ||
      (req.headers && req.headers['x-forwarded-proto']);
    const isSecure = Boolean(req.secure) || xfProto === 'https';

    let cookie = `cf_session_id=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${expires}`;
    if (isSecure) cookie += '; Secure';

    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Set-Cookie', cookie);
    }
  }

  req.sessionId = sessionId;

  const userAgent =
    typeof req.get === 'function'
      ? req.get('User-Agent')
      : req.headers?.['user-agent'] || req.headers?.['User-Agent'] || null;

  const rawIp = req.ip
    || (typeof req.get === 'function' ? req.get('X-Forwarded-For') : undefined)
    || req.headers?.['x-forwarded-for'];
  const normalizedIp = Array.isArray(rawIp)
    ? rawIp[0]
    : typeof rawIp === 'string'
      ? rawIp.split(',')[0].trim()
      : rawIp;

  const sessionMeta = {
    userAgent,
    ipHash: normalizedIp
      ? createHash('sha256').update(normalizedIp).digest('hex').substring(0, 16)
      : null,
  };
  req.sessionMeta = sessionMeta;

  // Update session in database only when user context is available
  try {
    if (req.user && req.user.id) {
      upsertSession(sessionId, { userId: req.user.id, ...sessionMeta });
    }
  } catch (error) {
    console.warn('[session] Failed to upsert session:', error.message);
  }

  next();
}
