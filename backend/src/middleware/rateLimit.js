// Simple in-memory rate limiter (per-IP) for MVP. Replace with Redis in production.
import { config } from '../env.js';

const buckets = new Map();

export function rateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = config.rate.windowSec * 1000;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = [];
    buckets.set(ip, bucket);
  }
  // drop old
  while (bucket.length && now - bucket[0] > windowMs) bucket.shift();
  if (bucket.length >= config.rate.max) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    return res.status(429).json({ error: 'rate_limit_exceeded', remaining: 0 });
  }
  bucket.push(now);
  res.setHeader('X-RateLimit-Limit', config.rate.max);
  res.setHeader('X-RateLimit-Remaining', config.rate.max - bucket.length);
  next();
}
