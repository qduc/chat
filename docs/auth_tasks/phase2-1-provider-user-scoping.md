# Phase 2.1: Provider User Scoping

## Overview
Update the provider system to support user-specific configurations while maintaining global provider availability.

## Tasks

### 1. Update Providers Table Schema
**File**: `backend/scripts/migrations/008-user-scoped-providers.js`

```sql
-- Add user_id column to providers table
ALTER TABLE providers ADD COLUMN user_id TEXT;

-- Add foreign key constraint
ALTER TABLE providers ADD CONSTRAINT fk_providers_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Create index for efficient user provider queries
CREATE INDEX idx_providers_user ON providers(user_id, enabled);
```

### 2. Update Provider Database Operations
**File**: `backend/src/db/providers.js`

Update functions to support user scoping:
```javascript
export function listProviders(userId) {
  // WHERE user_id = @user_id OR user_id IS NULL (global providers)
}

export function createProvider(providerData, userId) {
  // Include user_id in provider creation
}

export function updateProvider(providerId, updates, userId) {
  // Ensure user can only update their own providers
}

export function deleteProvider(providerId, userId) {
  // Ensure user can only delete their own providers
}
```

### 3. Update Provider API Routes
**File**: `backend/src/routes/providers.js`

Update routes to:
- Extract user ID from authenticated requests
- Scope provider operations by user
- Maintain backward compatibility for global providers
- Add validation for user ownership

### 4. Update Frontend Provider Management
**Files to update**:
- `frontend/components/providers/` - All provider components
- Provider configuration UI to show user vs global providers
- Add ability to create user-specific provider configurations

### 5. Provider Migration Logic
Create logic to:
- Distinguish between global and user providers
- Allow users to override global provider settings
- Handle provider inheritance patterns

## Acceptance Criteria
- [ ] Providers table supports user scoping
- [ ] Users can create personal provider configurations
- [ ] Global providers remain available to all users
- [ ] User providers take precedence over global ones
- [ ] Provider ownership validation works correctly
- [ ] Migration preserves existing provider data

## Dependencies
- Phase 1 (Core Authentication System)

## Estimated Time
6-8 hours