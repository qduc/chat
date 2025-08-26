import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

// Attaches a requestId and logs request lifecycle (start/end) with duration.
export function requestLogger(req, res, next) {
  // Honor incoming x-request-id if provided, else generate
  const incomingId = req.header('x-request-id');
  req.id = incomingId || randomUUID();

  const start = process.hrtime.bigint();

  logger.info({
    msg: 'request:start',
    req: {
      id: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip,
      sessionId: req.sessionId,
    },
  });

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    logger.info({
      msg: 'request:end',
      req: {
        id: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        sessionId: req.sessionId,
      },
      res: {
        statusCode: res.statusCode,
      },
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  // Propagate request id to client for correlation
  res.setHeader('x-request-id', req.id);

  next();
}

// Error logging helper middleware (to be used before final error handler if desired)
export function errorLogger(err, req, res, next) {
  logger.error({
    msg: 'request:error',
    err,
    req: {
      id: req?.id,
      method: req?.method,
      url: req?.originalUrl || req?.url,
      sessionId: req?.sessionId,
    },
  });
  next(err);
}
