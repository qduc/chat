import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

// Attaches a requestId and logs request lifecycle (start/end) with duration.
export function requestLogger(req, res, next) {
  // Honor incoming x-request-id if provided, else generate
  const incomingId = req.header('x-request-id');
  req.id = incomingId || randomUUID();

  const start = process.hrtime.bigint();
  let responseBody = null;

  // Capture response body for error responses
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function(body) {
    if (res.statusCode >= 400) {
      responseBody = body;
    }
    return originalJson(body);
  };

  res.send = function(body) {
    if (res.statusCode >= 400 && typeof body === 'string') {
      try {
        responseBody = JSON.parse(body);
      } catch {
        responseBody = body;
      }
    }
    return originalSend(body);
  };

  logger.debug({
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

    const logLevel = res.statusCode >= 400 ? 'error' : 'debug';
    const logData = {
      msg: 'request:end',
      req: {
        id: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        sessionId: req.sessionId,
      },
      res: {
        statusCode: res.statusCode,
        contentLength: res.get('content-length'),
      },
      durationMs: Math.round(durationMs * 1000) / 1000,
    };

    // Include request body and response body for failed requests to help with debugging
    if (res.statusCode >= 400) {
      if (req.body) {
        logData.req.body = req.body;
      }
      if (responseBody) {
        logData.res.body = responseBody;
      }
    }

    logger[logLevel](logData);
  });

  // Propagate request id to client for correlation
  res.setHeader('x-request-id', req.id);

  next();
}

// Error logging helper middleware (to be used before final error handler if desired)
export function errorLogger(err, req, res, next) {
  logger.error({
    msg: 'request:error',
    err: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code,
    },
    req: {
      id: req?.id,
      method: req?.method,
      url: req?.originalUrl || req?.url,
      sessionId: req?.sessionId,
      body: req?.body ? JSON.stringify(req.body, null, 2) : undefined,
      headers: req?.headers,
    },
  });
  next(err);
}
