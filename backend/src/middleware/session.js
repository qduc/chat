import { randomUUID } from 'crypto';

// Resolves session ID for the request based on header/cookie precedence.
// - Header x-session-id wins over cookie cf_session_id
// - If neither present, generate a request-scoped UUID (not persisted as cookie here)
export function sessionResolver(req, res, next) {
  let sessionId = req.header('x-session-id');
  if (!sessionId) {
    const cookieHeader = req.header('cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)cf_session_id=([^;]+)/);
    if (match) sessionId = decodeURIComponent(match[1]);
  }
  if (!sessionId) sessionId = randomUUID();
  req.sessionId = sessionId;
  next();
}
