# User Authentication Implementation Plan - ChatForge

## Overview

This document outlines the implementation plan for adding user authentication to ChatForge, a modern chat application with Next.js frontend and Node.js backend. The current system uses session-based data isolation, which provides a solid foundation for user authentication.

## Current Architecture Assessment

### Strengths (Ready for Auth)
- ✅ Session management system with `cf_session_id` cookies
- ✅ Database schema prepared with `user_id` fields (currently NULL)
- ✅ Session-based data isolation already implemented
- ✅ CORS configured for credentials (`allowedHeaders: ['Authorization']`)
- ✅ Frontend state management ready for user context
- ✅ Backend middleware pipeline supports additional auth layers

### Current Data Flow
```
Frontend → sessionResolver middleware → API routes → Database queries (filtered by session_id)
```

### Target Data Flow
```
Frontend → authMiddleware → sessionResolver → API routes → Database queries (filtered by user_id + session_id)
```

## Implementation Phases

### Phase 1: Core Authentication System

#### 1.1 Database Schema Updates

**Create Users Table:**
```sql
-- New migration: 006-users-table.js
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- UUID
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt hash
  display_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at DATETIME,
  deleted_at DATETIME
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created ON users(created_at);
```

**Update Sessions Table:**
```sql
-- Migration: 007-link-sessions-users.js
-- Update existing sessions to link with users
-- Add constraints for user_id FK
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
```

#### 1.2 Backend Authentication Layer

**New Dependencies:**
```bash
cd backend
npm install bcryptjs jsonwebtoken express-rate-limit
```

**Authentication Middleware** (`backend/src/middleware/auth.js`):
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

**User Database Operations** (`backend/src/db/users.js`):
```javascript
export function createUser({ id, email, passwordHash, displayName });
export function getUserById(id);
export function getUserByEmail(email);
export function updateUserLastLogin(id);
export function linkSessionToUser(sessionId, userId);
```

**Authentication Routes** (`backend/src/routes/auth.js`):
```javascript
// POST /v1/auth/register
// POST /v1/auth/login
// POST /v1/auth/logout
// GET /v1/auth/me
// POST /v1/auth/refresh
```

#### 1.3 API Security Updates

**Update Route Protection:**
```javascript
// backend/src/index.js
import { authenticateToken, optionalAuth } from './middleware/auth.js';

// Protected routes
app.use('/v1/conversations', authenticateToken);
app.use('/v1/providers', authenticateToken);

// Semi-protected (optional auth)
app.use('/v1/chat/completions', optionalAuth);
```

**Update Database Queries:**
```javascript
// backend/src/db/conversations.js - Update all queries
export function listConversations({ userId, sessionId, cursor, limit }) {
  // WHERE (user_id = @user_id OR (user_id IS NULL AND session_id = @session_id))
}
```

#### 1.4 Frontend Authentication Integration

**New Dependencies:**
```bash
cd frontend
npm install @types/jsonwebtoken
```

**Authentication Context** (`frontend/contexts/AuthContext.tsx`):
```typescript
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}
```

**Token Management** (`frontend/lib/auth/tokens.ts`):
```typescript
export function getToken(): string | null;
export function setToken(token: string): void;
export function removeToken(): void;
export function isTokenExpired(token: string): boolean;
```

**Authentication Components:**
- `frontend/components/auth/LoginForm.tsx`
- `frontend/components/auth/RegisterForm.tsx`
- `frontend/components/auth/ProtectedRoute.tsx`
- `frontend/components/auth/AuthModal.tsx`

#### 1.5 State Management Updates

**Update Chat State** (`frontend/hooks/useChatState.ts`):
```typescript
export interface ChatState {
  // Add user context
  user: User | null;
  isAuthenticated: boolean;
  // ... existing fields
}

// Add authentication actions
export type ChatAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }
  // ... existing actions
```

### Phase 2: Enhanced User Features

#### 2.1 Provider User Scoping

**Update Providers Table:**
```sql
-- Migration: 008-user-scoped-providers.js
ALTER TABLE providers ADD COLUMN user_id TEXT;
ALTER TABLE providers ADD CONSTRAINT fk_providers_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Create index for user provider queries
CREATE INDEX idx_providers_user ON providers(user_id, enabled);
```

**Update Provider Operations:**
```javascript
// backend/src/db/providers.js - All operations scoped by user_id
export function listProviders(userId) {
  // WHERE user_id = @user_id OR user_id IS NULL (global providers)
}
```

#### 2.2 Migration Strategy for Existing Data

**Session-to-User Migration** (`backend/scripts/migrateToUsers.js`):
```javascript
// Create anonymous users for existing sessions
// Link conversations to new user accounts
// Preserve session continuity during migration
```

**Migration Commands:**
```bash
# Run migration script
npm run migrate-users

# Verify data integrity
npm run verify-migration
```

### Phase 3: Advanced Authentication Features

#### 3.1 Email Verification

**Email Service Integration:**
```javascript
// backend/src/lib/emailService.js - Using Nodemailer or SendGrid
export function sendVerificationEmail(email, token);
export function sendPasswordResetEmail(email, token);
```

**Verification Routes:**
```javascript
// POST /v1/auth/verify-email
// POST /v1/auth/resend-verification
// POST /v1/auth/forgot-password
// POST /v1/auth/reset-password
```

#### 3.2 Enhanced Security

**Rate Limiting:**
```javascript
// backend/src/middleware/rateLimitAuth.js
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'too_many_login_attempts' }
});
```

**Session Security:**
```javascript
// Implement session invalidation
// Token refresh mechanism
// Device/session tracking
```

## Implementation Order

### Week 1-2: Foundation
1. ✅ Database migrations (users table, FK constraints)
2. ✅ Backend auth middleware and JWT handling
3. ✅ Basic auth routes (register, login, logout)
4. ✅ Update API route protection

### Week 3: Frontend Integration
1. ✅ Authentication context and hooks
2. ✅ Login/Register forms
3. ✅ Token management
4. ✅ Update API client for auth headers

### Week 4: Data Migration & Testing
1. ✅ Session-to-user migration scripts
2. ✅ Comprehensive testing
3. ✅ Error handling and edge cases
4. ✅ User experience polish

### Week 5: Enhanced Features (Optional)
1. ✅ User-scoped provider configurations
2. ✅ Email verification
3. ✅ Password reset functionality
4. ✅ Rate limiting and security hardening

## Technical Considerations

### Database Strategy
- **Backward Compatibility**: Existing sessions remain valid during transition
- **Gradual Migration**: Users can continue using the app anonymously
- **Data Integrity**: Foreign key constraints ensure referential integrity
- **Performance**: Proper indexing on user_id columns

### Security Best Practices
- **Password Hashing**: bcrypt with salt rounds >= 12
- **JWT Security**: Short-lived access tokens (15min) + refresh tokens
- **Rate Limiting**: Protect auth endpoints from brute force
- **HTTPS Only**: Ensure secure token transmission
- **Input Validation**: Validate email format, password strength

### Frontend UX
- **Progressive Enhancement**: Anonymous usage → account creation prompts
- **Seamless Migration**: Convert anonymous sessions to user accounts
- **Error Handling**: Clear feedback for auth failures
- **Loading States**: Smooth authentication flows

### API Design
- **RESTful Endpoints**: Standard auth patterns
- **Error Responses**: Consistent error format
- **Token Headers**: Bearer token authentication
- **Session Continuity**: Maintain chat state during auth transitions

## Environment Variables

### Backend (.env)
```bash
# Authentication
JWT_SECRET=your-super-secret-jwt-key-minimum-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Email (if implementing verification)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-app@gmail.com
SMTP_PASS=your-app-password
```

### Frontend (.env.local)
```bash
# API Configuration
NEXT_PUBLIC_API_BASE=http://localhost:3001
NEXT_PUBLIC_APP_NAME=ChatForge
```

## Testing Strategy

### Backend Tests
- Unit tests for auth middleware
- Integration tests for auth routes
- Database migration tests
- Rate limiting tests

### Frontend Tests
- Auth context provider tests
- Login/Register form tests
- Token management tests
- Protected route tests

### E2E Tests
- Complete registration flow
- Login/logout cycle
- Session persistence
- Anonymous to authenticated migration

## Deployment Considerations

### Database Migrations
```bash
# Production deployment sequence
1. Deploy migration scripts
2. Run migrations with downtime window
3. Deploy new application code
4. Verify authentication flows
```

### Environment Security
- Rotate JWT secrets in production
- Use environment-specific SMTP credentials
- Configure CORS for production domains
- Set up proper logging for auth events

## Success Metrics

### Phase 1 Success Criteria
- [ ] Users can register and login successfully
- [ ] Existing sessions continue to work
- [ ] Conversations are properly scoped to users
- [ ] No data loss during migration
- [ ] Performance remains acceptable

### Phase 2 Success Criteria
- [ ] User-scoped provider configurations work
- [ ] Migration from anonymous to authenticated is seamless
- [ ] All security best practices implemented
- [ ] Comprehensive error handling

## Risk Mitigation

### Data Loss Prevention
- Complete database backups before migrations
- Rollback procedures documented
- Migration scripts tested on staging data
- Gradual rollout with monitoring

### Security Risks
- Regular security audits of auth implementation
- Input validation and sanitization
- Rate limiting to prevent abuse
- Secure token storage and transmission

### User Experience Risks
- Anonymous usage remains available
- Clear migration paths for existing users
- Progressive disclosure of auth features
- Fallback mechanisms for auth failures

---

## Next Steps

1. **Review and Approve**: Team review of implementation plan
2. **Environment Setup**: Configure development environment variables
3. **Database Planning**: Schedule migration window and backup procedures
4. **Development Start**: Begin with Phase 1 implementation
5. **Testing Strategy**: Set up comprehensive testing pipeline

This implementation plan provides a comprehensive roadmap for adding robust user authentication to ChatForge while maintaining backward compatibility and following security best practices.