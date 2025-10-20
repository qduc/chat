'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

export type AuthMode = 'login' | 'register';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  initialMode?: AuthMode;
  onSuccess?: () => void;
}

export function AuthModal({ open, onClose, initialMode = 'login', onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  // Update mode when initialMode changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const handleSuccess = () => {
    onSuccess?.();
    onClose();
  };

  const switchToLogin = () => setMode('login');
  const switchToRegister = () => setMode('register');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'login' ? 'Sign in to ChatForge' : 'Create your account'}
      maxWidthClassName="max-w-md"
    >
      {mode === 'login' ? (
        <LoginForm onSuccess={handleSuccess} onSwitchToRegister={switchToRegister} />
      ) : (
        <RegisterForm onSuccess={handleSuccess} onSwitchToLogin={switchToLogin} />
      )}
    </Modal>
  );
}
