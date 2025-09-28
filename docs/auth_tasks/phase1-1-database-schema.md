# Phase 1.1: Database Schema Updates

## Overview
Set up the database foundation for user authentication by creating the users table and updating the sessions table to link with users.

## Tasks

### 1. Create Users Table Migration
**File**: `backend/scripts/migrations/006-users-table.js`

```sql
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

### 2. Update Sessions Table Migration
**File**: `backend/scripts/migrations/007-link-sessions-users.js`

```sql
-- Add foreign key constraint
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
```

## Acceptance Criteria
- [ ] Users table created with all required fields
- [ ] Proper indexes created for performance
- [ ] Sessions table linked to users via foreign key
- [ ] Migration scripts run successfully
- [ ] Database schema validates properly

## Dependencies
- None (foundation task)

## Estimated Time
2-3 hours