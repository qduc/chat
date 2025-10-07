import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_PREFIX = 'upstream-requests-';
const RESPONSE_LOG_PREFIX = 'upstream-responses-';
const RETENTION_DAYS = Number(process.env.UPSTREAM_LOG_RETENTION_DAYS || 7);

function resolveLogDir() {
  const candidates = [process.env.UPSTREAM_LOG_DIR, '/app/logs', path.join(process.cwd(), 'logs'), path.join(os.tmpdir(), 'chat-logs')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // try next
    }
  }
  return os.tmpdir();
}

function cleanupOldLogs(logDir) {
  try {
    const files = readdirSync(logDir);
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    files.forEach((file) => {
      if (!file.startsWith(LOG_PREFIX) || !file.endsWith('.log')) return;
      const datePart = file.slice(LOG_PREFIX.length, -4); // strip prefix and .log
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;
      const fileDate = new Date(datePart);
      if (Number.isNaN(fileDate.getTime())) return;
      const ageDays = (now - fileDate.getTime()) / msPerDay;
      if (ageDays > RETENTION_DAYS) {
        try {
          unlinkSync(path.join(logDir, file));
        } catch (unlinkErr) {
          console.error('Failed to remove old log file:', file, unlinkErr.message);
        }
      }
    });
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to cleanup old log files:', err.message);
    }
  }
}

const LOG_DIR = resolveLogDir();

export function logUpstreamRequest({ url, headers, body }) {
  if (process.env.NODE_ENV === 'test') return;

  const logEntry = `[${new Date().toISOString()}] UPSTREAM REQUEST\n${JSON.stringify({
    url,
    method: 'POST',
    headers: { ...headers, Authorization: headers?.Authorization ? '[REDACTED]' : undefined },
    body: { ...body, tools: body?.tools ? '[OMITTED]' : undefined },
  }, null, 2)}\n\n`;

  try {
    cleanupOldLogs(LOG_DIR);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const filename = `${LOG_PREFIX}${dateStr}.log`;
    const filePath = path.join(LOG_DIR, filename);
    appendFileSync(filePath, logEntry);
  } catch (err) {
    console.error('Failed to write to upstream log file:', err?.message || err);
  }
}

export function logUpstreamResponse({ url, status, headers, body }) {
  if (process.env.NODE_ENV === 'test') return;

  const isEventStream = headers?.['content-type']?.includes('text/event-stream');
  const logBody = isEventStream ? body : JSON.stringify(body, null, 2);

  const logEntry = `[${new Date().toISOString()}] UPSTREAM RESPONSE\n${JSON.stringify({
    url,
    status,
    headers: { ...headers, 'set-cookie': headers?.['set-cookie'] ? '[REDACTED]' : undefined },
    body: logBody,
  }, null, 2)}\n\n`;

  try {
    cleanupOldLogs(LOG_DIR);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const filename = `${RESPONSE_LOG_PREFIX}${dateStr}.log`;
    const filePath = path.join(LOG_DIR, filename);
    appendFileSync(filePath, logEntry);
  } catch (err) {
    console.error('Failed to write to upstream response log file:', err?.message || err);
  }
}

export default {
  logUpstreamRequest,
  logUpstreamResponse,
};
