# Phase 1.4: Frontend Authentication Integration

## Overview
Implement frontend authentication components, context, and token management to enable user login/registration.

## Tasks

### 1. Install Dependencies
```bash
cd frontend
npm install @types/jsonwebtoken
```

### 2. Create Authentication Context
**File**: `frontend/contexts/AuthContext.tsx`

```typescript
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}
```

### 3. Create Token Management
**File**: `frontend/lib/auth/tokens.ts`

Implement functions:
- `getToken(): string | null`
- `setToken(token: string): void`
- `removeToken(): void`
- `isTokenExpired(token: string): boolean`

### 4. Create Authentication Components
**Files to create**:
- `frontend/components/auth/LoginForm.tsx`
- `frontend/components/auth/RegisterForm.tsx`
- `frontend/components/auth/ProtectedRoute.tsx`
- `frontend/components/auth/AuthModal.tsx`

### 5. Update API Client
Modify `frontend/lib/chat/client.ts` to:
- Include Authorization header when token exists
- Handle 401/403 responses appropriately
- Refresh tokens when needed

### 6. Update Environment Variables
Add to frontend `.env.local`:
```bash
NEXT_PUBLIC_API_BASE=http://localhost:3001
NEXT_PUBLIC_APP_NAME=ChatForge
```

## Acceptance Criteria
- [ ] Authentication context provides user state
- [ ] Token management works correctly
- [ ] Login/register forms function properly
- [ ] Protected routes redirect unauthenticated users
- [ ] API client includes auth headers
- [ ] Token refresh mechanism works
- [ ] Environment variables configured

## Dependencies
- Phase 1.3 (API Security Updates)

## Estimated Time
8-10 hours