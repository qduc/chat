import { logger } from '../logger.js';

export function exceptionHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    // Log the exception with full context
    logger.error({
        msg: message,
        err: {
            message: err.message,
            stack: err.stack,
            name: err.name,
            code: err.code,
            ...err // Include other properties
        },
        req: {
            id: req.id,
            method: req.method,
            url: req.originalUrl || req.url,
            ip: req.ip,
            sessionId: req.sessionId,
            body: req.body,
            query: req.query,
            params: req.params,
        },
    });

    // Send response
    res.status(statusCode).json({
        error: {
            message: statusCode === 500 && process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : message,
            ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
        }
    });
}
