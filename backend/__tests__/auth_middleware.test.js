import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  optionalAuth,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} from '../src/middleware/auth.js';
import { config } from '../src/env.js';
import { createUser } from '../src/db/users.js';
import { getDb, resetDbCache } from '../src/db/index.js';

const JWT_SECRET = config.auth.jwtSecret;

describe('Authentication Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let db;

  beforeEach(() => {
    resetDbCache();
    db = getDb();
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM users;
    `);

    mockReq = {
      headers: {},
      header: jest.fn()
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    resetDbCache();
  });

  describe('authenticateToken', () => {
    test('should reject request without token', () => {
      mockReq.headers.authorization = undefined;

      authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'authentication_required',
        message: 'No authorization token provided'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should reject invalid token', () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        message: 'Invalid token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should accept valid token and set user', () => {
      const createdUser = createUser({
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        displayName: 'Test User'
      });

      const token = jwt.sign({ userId: createdUser.id }, JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateToken(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual({
        id: createdUser.id,
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: 0
      });
      expect(mockNext).toHaveBeenCalled();
    });

    test('should reject token for non-existent user', () => {
      const token = jwt.sign({ userId: 'user-123' }, JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        message: 'User no longer exists'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    test('should continue without token', () => {
      mockReq.headers.authorization = undefined;

      optionalAuth(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeNull();
      expect(mockNext).toHaveBeenCalled();
    });

    test('should set user for valid token', () => {
      const createdUser = createUser({
        email: 'verified@example.com',
        passwordHash: 'hashed-password',
        displayName: 'Verified User'
      });

      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(createdUser.id);

      const token = jwt.sign({ userId: createdUser.id }, JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;

      optionalAuth(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual({
        id: createdUser.id,
        email: 'verified@example.com',
        displayName: 'Verified User',
        emailVerified: 1
      });
      expect(mockNext).toHaveBeenCalled();
    });

    test('should continue with null user for invalid token', () => {
      mockReq.headers.authorization = 'Bearer invalid-token';

      optionalAuth(mockReq, mockRes, mockNext);

      expect(mockReq.user).toBeNull();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Token generation and verification', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com'
    };

    test('should generate access token', () => {
      const token = generateAccessToken(mockUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
    });

    test('should generate refresh token', () => {
      const token = generateRefreshToken(mockUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.userId).toBe('user-123');
      expect(decoded.type).toBe('refresh');
    });

    test('should verify refresh token', () => {
      const token = generateRefreshToken(mockUser);
      const decoded = verifyRefreshToken(token);

      expect(decoded.userId).toBe('user-123');
      expect(decoded.type).toBe('refresh');
    });

    test('should reject invalid refresh token type', () => {
      const accessToken = generateAccessToken(mockUser);

      expect(() => verifyRefreshToken(accessToken)).toThrow('Invalid token type');
    });
  });
});