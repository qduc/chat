# Phase 3.1: Email Verification System

## Overview
Implement email verification functionality to ensure valid email addresses and enable password reset capabilities.

## Tasks

### 1. Install Email Dependencies
```bash
cd backend
npm install nodemailer
# OR
npm install @sendgrid/mail
```

### 2. Create Email Service
**File**: `backend/src/lib/emailService.js`

Implement email service with:
```javascript
export async function sendVerificationEmail(email, token);
export async function sendPasswordResetEmail(email, token);
export async function sendWelcomeEmail(email, displayName);
```

Configuration options:
- Nodemailer with SMTP (Gmail, etc.)
- SendGrid integration
- Template-based emails
- Error handling and retries

### 3. Create Email Templates
**Directory**: `backend/src/templates/emails/`

Templates needed:
- `verification.html` - Email verification
- `password-reset.html` - Password reset
- `welcome.html` - Welcome email
- Base template with consistent styling

### 4. Update User Database Operations
**File**: `backend/src/db/users.js`

Add functions:
```javascript
export async function createEmailVerificationToken(userId);
export async function verifyEmailToken(token);
export async function createPasswordResetToken(email);
export async function validatePasswordResetToken(token);
export async function markEmailAsVerified(userId);
```

### 5. Create Email Verification Routes
**File**: `backend/src/routes/auth.js`

Add routes:
- `POST /v1/auth/verify-email` - Verify email with token
- `POST /v1/auth/resend-verification` - Resend verification email
- `POST /v1/auth/forgot-password` - Request password reset
- `POST /v1/auth/reset-password` - Reset password with token

### 6. Update Registration Flow
Modify registration to:
- Send verification email after signup
- Mark email as unverified initially
- Optionally require verification before full access

### 7. Frontend Email Verification Components
**Files to create**:
- `frontend/components/auth/EmailVerificationForm.tsx`
- `frontend/components/auth/PasswordResetForm.tsx`
- `frontend/components/auth/ForgotPasswordForm.tsx`
- `frontend/pages/verify-email.tsx`
- `frontend/pages/reset-password.tsx`

### 8. Environment Configuration
Add to backend `.env`:
```bash
# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-app@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=noreply@chatforge.app
FROM_NAME=ChatForge

# OR SendGrid
SENDGRID_API_KEY=your-sendgrid-api-key
```

## Acceptance Criteria
- [ ] Email service sends verification emails
- [ ] Users can verify their email addresses
- [ ] Password reset flow works end-to-end
- [ ] Email templates are professional and branded
- [ ] Verification tokens are secure and time-limited
- [ ] Frontend components handle all email flows
- [ ] Error handling for email delivery issues

## Dependencies
- Phase 1 (Core Authentication System)

## Estimated Time
10-12 hours