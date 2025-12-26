import React from 'react';

interface HeaderButtonProps {
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}

export function HeaderButton({
  onClick,
  children,
  className = '',
  type = 'button',
  title,
}: HeaderButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all duration-200 hover:shadow-sm ${className}`}
    >
      {children}
    </button>
  );
}

export default HeaderButton;
