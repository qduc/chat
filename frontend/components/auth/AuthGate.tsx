'use client';

import React, { useState } from 'react';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import type { AuthMode } from './AuthModal';

export function AuthGate() {
  const [mode, setMode] = useState<AuthMode>('login');

  const isLogin = mode === 'login';

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-gradient-to-br from-slate-50 via-white to-slate-100/60 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900/40">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-slate-200/70 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 shadow-xl backdrop-blur-sm p-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {isLogin ? 'Sign in to continue' : 'Create your ChatForge account'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isLogin
              ? 'Access your saved conversations and personalized settings.'
              : 'Set up your account to start building your conversation history.'}
          </p>
        </div>

        {isLogin ? (
          <LoginForm
            onSwitchToRegister={() => setMode('register')}
          />
        ) : (
          <RegisterForm
            onSwitchToLogin={() => setMode('login')}
          />
        )}
      </div>
    </div>
  );
}
