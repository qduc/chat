import { randomUUID } from 'crypto';

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
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    let cookie = `cf_session_id=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${expires}`;
    if (isSecure) cookie += '; Secure';

    res.setHeader('Set-Cookie', cookie);
  }

  req.sessionId = sessionId;
  next();
}
