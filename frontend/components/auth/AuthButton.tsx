'use client';

import React from 'react';
import { User, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface AuthButtonProps {
  className?: string;
  onShowLogin?: () => void;
  onShowRegister?: () => void;
}

export function AuthButton({ className = '', onShowLogin, onShowRegister }: AuthButtonProps) {
  const { user, logout, loading } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-8 w-8 bg-slate-300 dark:bg-neutral-700 rounded-full"></div>
      </div>
    );
  }

  if (user) {
    return (
      <div className={`relative group ${className}`}>
        <button
          onClick={handleLogout}
          className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
          title={`Signed in as ${user.displayName || user.email}`}
        >
          <User className="w-4 h-4" />
          <span className="hidden sm:inline truncate max-w-24">
            {user.displayName || user.email.split('@')[0]}
          </span>
          <LogOut className="w-3 h-3 opacity-70" />
        </button>
      </div>
    );
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