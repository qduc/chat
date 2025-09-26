import { describe, expect, test, jest } from '@jest/globals';
import {
  authenticateToken,
  optionalAuth,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} from '../src/middleware/auth.js';
import jwt from 'jsonwebtoken';

// Mock the config
jest.mock('../src/env.js', () => ({
  config: {
    auth: {
      jwtSecret: 'test-secret-key-for-testing-only',
      jwtExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d'
    }
  }
}));

// Mock the user database
jest.mock('../src/db/users.js', () => ({
  getUserById: jest.fn()
}));

import { getUserById } from '../src/db/users.js';

describe('Authentication Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      headers: {},
      header: jest.fn()
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
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
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        display_name: 'Test User',
        email_verified: false
      };

      getUserById.mockReturnValue(mockUser);

      const token = jwt.sign({ userId: 'user-123' }, 'test-secret-key-for-testing-only');
      mockReq.headers.authorization = `Bearer ${token}`;

      authenticateToken(mockReq, mockRes, mockNext);

      expect(getUserById).toHaveBeenCalledWith('user-123');
      expect(mockReq.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: false
      });
      expect(mockNext).toHaveBeenCalled();
    });

    test('should reject token for non-existent user', () => {
      getUserById.mockReturnValue(null);

      const token = jwt.sign({ userId: 'user-123' }, 'test-secret-key-for-testing-only');
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
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        display_name: 'Test User',
        email_verified: true
      };

      getUserById.mockReturnValue(mockUser);

      const token = jwt.sign({ userId: 'user-123' }, 'test-secret-key-for-testing-only');
      mockReq.headers.authorization = `Bearer ${token}`;

      optionalAuth(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: true
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

      const decoded = jwt.verify(token, 'test-secret-key-for-testing-only');
      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
    });

    test('should generate refresh token', () => {
      const token = generateRefreshToken(mockUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, 'test-secret-key-for-testing-only');
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