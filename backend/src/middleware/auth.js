import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { getUserById } from '../db/users.js';
import { upsertSession } from '../db/sessions.js';
import { config } from '../env.js';

/**
 * Middleware that requires authentication
 * Returns 401 if no token provided, 403 if token invalid
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'authentication_required',
      message: 'No authorization token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);

    // Get fresh user data to ensure user still exists
    const user = getUserById(decoded.userId);
    if (!user) {
      return res.status(403).json({
        error: 'invalid_token',
        message: 'User no longer exists'
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerified: user.email_verified
    };

    if (req.sessionId) {
      try {
        const sessionMeta = req.sessionMeta || {
          userAgent: req.get('User-Agent') || null,
          ipHash: req.ip
            ? createHash('sha256').update(req.ip).digest('hex').substring(0, 16)
            : null,
        };
        upsertSession(req.sessionId, { userId: user.id, ...sessionMeta });
      } catch (sessionErr) {
        console.warn('[auth] Failed to upsert session during authentication:', sessionErr.message);
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'token_expired',
        message: 'Token has expired'
      });
    } else if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({
        error: 'invalid_token',
        message: 'Invalid token'
      });
    }

    return res.status(500).json({
      error: 'auth_error',
      message: 'Authentication error'
    });
  }
}

/**
 * Optional authentication middleware
 * Sets req.user if valid token provided, but doesn't fail if no token
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);

    // Get fresh user data to ensure user still exists
    const user = getUserById(decoded.userId);
    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        emailVerified: user.email_verified
      };
    } else {
      req.user = null;
    }
  } catch {
    // Silently fail for optional auth
    req.user = null;
  }

  next();
}

/**
 * Middleware to get user from session or token
 * Now requires authentication - session fallback removed as part of Phase 1
 */
export function getUserContext(req, res, next) {
  // Require authentication
  authenticateToken(req, res, () => {
    // User context is now guaranteed by authenticateToken
    next();
  });
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh'
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtRefreshExpiresIn }
  );
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, config.auth.jwtSecret);
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return decoded;
}
