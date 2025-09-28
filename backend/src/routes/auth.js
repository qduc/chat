import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateLastLogin,
  linkSessionToUser,
  isEmailAvailable
} from '../db/users.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken
} from '../middleware/auth.js';

const router = Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per IP
  message: { error: 'too_many_requests', message: 'Too many authentication attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration rate limiting (more restrictive)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'registration_limit', message: 'Too many registration attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /v1/auth/register
 * Register a new user
 */
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Email and password are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email',
        message: 'Please provide a valid email address'
      });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({
        error: 'weak_password',
        message: 'Password must be at least 8 characters long'
      });
    }

    // Check if email is available
    if (!isEmailAvailable(email)) {
      return res.status(409).json({
        error: 'email_taken',
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = createUser({
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName: displayName?.trim() || null
    });

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Link session to user if session exists
    if (req.sessionId) {
      linkSessionToUser(req.sessionId, user.id);
    }

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        emailVerified: user.email_verified,
        createdAt: user.created_at
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('[auth] Registration error:', error);
    res.status(500).json({
      error: 'registration_failed',
      message: 'Failed to create account'
    });
  }
});

/**
 * POST /v1/auth/login
 * Authenticate user and return tokens
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Email and password are required'
      });
    }

    // Get user with password hash for verification
    const user = getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password'
      });
    }

    // Update last login
    updateLastLogin(user.id);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Link session to user if session exists
    if (req.sessionId) {
      linkSessionToUser(req.sessionId, user.id);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        emailVerified: user.email_verified,
        createdAt: user.created_at,
        lastLoginAt: new Date().toISOString()
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    console.error('[auth] Login error:', error);
    res.status(500).json({
      error: 'login_failed',
      message: 'Failed to authenticate'
    });
  }
});

/**
 * POST /v1/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Get fresh user data
    const user = getUserById(decoded.userId);
    if (!user) {
      return res.status(403).json({
        error: 'invalid_token',
        message: 'User no longer exists'
      });
    }

    // Generate new access token
    const accessToken = generateAccessToken(user);

    res.json({
      accessToken
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'refresh_token_expired',
        message: 'Refresh token has expired'
      });
    } else if (error.name === 'JsonWebTokenError' || error.message === 'Invalid token type') {
      return res.status(403).json({
        error: 'invalid_refresh_token',
        message: 'Invalid refresh token'
      });
    }

    console.error('[auth] Refresh token error:', error);
    res.status(500).json({
      error: 'refresh_failed',
      message: 'Failed to refresh token'
    });
  }
});

/**
 * GET /v1/auth/me
 * Get current user profile
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

/**
 * POST /v1/auth/logout
 * Logout (client-side token removal)
 */
router.post('/logout', (req, res) => {
  // With JWTs, logout is mainly client-side token removal
  // We could implement server-side token blacklisting in the future
  res.json({
    message: 'Logged out successfully'
  });
});

export default router;