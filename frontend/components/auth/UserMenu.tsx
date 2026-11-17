'use client';

import React from 'react';
import { User, LogOut } from 'lucide-react';
import { iconButtonClasses } from '../ui/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu';

interface UserMenuProps {
  user: {
    displayName?: string;
    email: string;
  };
  onLogout: () => Promise<void>;
  className?: string;
}

export function UserMenu({ user, onLogout, className = '' }: UserMenuProps) {
  const handleLogout = async () => {
    try {
      await onLogout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const displayName = user.displayName || user.email.split('@')[0];

  return (
    <div className={className}>
      <Menu>
        <MenuTrigger
          className={iconButtonClasses()}
          title={`Signed in as ${user.displayName || user.email}`}
          aria-label="User menu"
        >
          <User />
        </MenuTrigger>
        <MenuContent className="w-64">
          <div className="flex items-center gap-3 px-3 py-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emphasis text-sm font-medium text-fg"
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{displayName}</div>
              <div className="truncate text-xs text-fg-muted">{user.email}</div>
            </div>
          </div>
          <MenuSeparator />
          <MenuItem onClick={handleLogout}>
            <LogOut />
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
