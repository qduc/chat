'use client';

import React from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { UserMenu } from './UserMenu';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';

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
    <div className={cn('flex items-center gap-2', className)}>
      <Button variant="ghost" size="sm" onClick={onShowLogin}>
        <LogIn />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
      <Button variant="primary" size="sm" onClick={onShowRegister}>
        Sign up
      </Button>
    </div>
  );
}
