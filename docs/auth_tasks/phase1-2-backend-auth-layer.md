# Phase 1.2: Backend Authentication Layer

## Overview
Implement the core authentication middleware, user database operations, and authentication routes.

## Tasks

### 1. Install Dependencies
```bash
cd backend
npm install bcryptjs jsonwebtoken express-rate-limit
```

### 2. Create Authentication Middleware
**File**: `backend/src/middleware/auth.js`

```javascript
import jwt from 'jsonwebtoken';
import { getUserById } from '../db/users.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'authentication_required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'invalid_token' });
    req.user = user;
    next();
  });
}

export function optionalAuth(req, res, next) {
  // Similar to above but doesn't require token - sets req.user if present
}
```

### 3. Create User Database Operations
**File**: `backend/src/db/users.js`

Implement functions:
- `createUser({ id, email, passwordHash, displayName })`
- `getUserById(id)`
- `getUserByEmail(email)`
- `updateUserLastLogin(id)`
- `linkSessionToUser(sessionId, userId)`

### 4. Create Authentication Routes
**File**: `backend/src/routes/auth.js`

Implement routes:
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `POST /v1/auth/refresh`

## Acceptance Criteria
- [ ] Dependencies installed successfully
- [ ] Authentication middleware handles JWT tokens
- [ ] Optional auth middleware allows anonymous access
- [ ] User database operations work correctly
- [ ] All auth routes implemented and tested
- [ ] Proper error handling for auth failures

## Dependencies
- Phase 1.1 (Database Schema Updates)

## Estimated Time
6-8 hours