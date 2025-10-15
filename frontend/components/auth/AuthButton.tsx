'use client';

import React from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { UserMenu } from './UserMenu';

interface AuthButtonProps {
  className?: string;
  onShowLogin?: () => void;
  onShowRegister?: () => void;
}

export function AuthButton({ className = '', onShowLogin, onShowRegister }: AuthButtonProps) {
  const { user, logout } = useAuth();

  if (user) {
    return <UserMenu user={user} onLogout={logout} className={className} />;
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <button
        onClick={onShowLogin}
        className="flex items-center space-x-1 px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
      >
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">Sign in</span>
      </button>
      <button
        onClick={onShowRegister}
        className="px-3 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
      >
        Sign up
      </button>
    </div>
  );
}
