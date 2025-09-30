'use client';

import React, { useState, useEffect, useRef } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';

interface UserMenuProps {
  user: {
    displayName?: string;
    email: string;
  };
  onLogout: () => Promise<void>;
  className?: string;
}

export function UserMenu({ user, onLogout, className = '' }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await onLogout();
      setIsOpen(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const displayName = user.displayName || user.email.split('@')[0];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
        title={`Signed in as ${user.displayName || user.email}`}
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <User className="w-4 h-4 text-slate-700 dark:text-slate-200" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 w-64 mt-2 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-hidden z-50">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {displayName}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {user.email}
                </div>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <LogOut className="w-4 h-4 mr-3 text-slate-500" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}