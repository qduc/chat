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
      className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-all duration-200 hover:shadow-sm ${className}`}
    >
      {children}
    </button>
  );
}

export default HeaderButton;
