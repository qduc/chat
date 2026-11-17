'use client';

import React, { useState } from 'react';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { Logo } from '../ui/Logo';
import type { AuthMode } from './AuthModal';

export function AuthGate() {
  const [mode, setMode] = useState<AuthMode>('login');

  const isLogin = mode === 'login';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas-subtle px-4 py-8">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          {}
          <img src="/logo.png" alt="" className="size-8" />
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-medium text-fg">
              {isLogin ? 'Sign in to continue' : 'Create your ChatForge account'}
            </h1>
            <p className="text-sm text-fg-muted">
              {isLogin
                ? 'Access your saved conversations and personalized settings.'
                : 'Set up your account to start building your conversation history.'}
            </p>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-6">
          {isLogin ? (
            <LoginForm onSwitchToRegister={() => setMode('register')} />
          ) : (
            <RegisterForm onSwitchToLogin={() => setMode('login')} />
          )}
        </div>
      </div>
    </main>
  );
}
