# Phase 1.3: API Security Updates

## Overview
Update existing API routes to use authentication middleware and modify database queries to support user-scoped data.

## Tasks

### 1. Update Route Protection
**File**: `backend/src/index.js`

```javascript
import { authenticateToken, optionalAuth } from './middleware/auth.js';

// Protected routes
app.use('/v1/conversations', authenticateToken);
app.use('/v1/providers', authenticateToken);

// Semi-protected (optional auth)
app.use('/v1/chat/completions', optionalAuth);
```

### 2. Update Database Queries for User Scoping
**Files to update**:
- `backend/src/db/conversations.js`
- `backend/src/db/messages.js`
- Any other data access files

**Example Update**:
```javascript
// backend/src/db/conversations.js
export function listConversations({ userId, sessionId, cursor, limit }) {
  // WHERE (user_id = @user_id OR (user_id IS NULL AND session_id = @session_id))
}
```

### 3. Update API Route Handlers
Update route handlers to:
- Extract user ID from `req.user`
- Pass user ID to database operations
- Maintain backward compatibility with session-only access

### 4. Environment Variables Setup
Add to backend `.env`:
```bash
JWT_SECRET=your-super-secret-jwt-key-minimum-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

## Acceptance Criteria
- [ ] Protected routes require authentication
- [ ] Optional auth routes work with and without tokens
- [ ] Database queries properly scope data by user_id
- [ ] Backward compatibility maintained for sessions
- [ ] Environment variables configured
- [ ] All existing functionality continues to work

## Dependencies
- Phase 1.2 (Backend Authentication Layer)

## Estimated Time
4-6 hours