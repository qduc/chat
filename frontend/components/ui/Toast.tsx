'use client';
import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';
import { IconButton } from './Button';

type ToastVariant = 'success' | 'error' | 'info';

type ToastInput = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toastIconTone: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-fg-muted',
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  switch (variant) {
    case 'success':
      return <CheckCircle className="w-4 h-4" />;
    case 'error':
      return <XCircle className="w-4 h-4" />;
    case 'info':
    default:
      return <Info className="w-4 h-4" />;
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timeoutsRef = React.useRef<Map<string, number>>(new Map());
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const showToast = React.useCallback(
    ({ message, variant = 'info', duration = 3000 }: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const timeoutId = window.setTimeout(() => dismissToast(id), duration);
      timeoutsRef.current.set(id, timeoutId);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed top-4 right-4 left-4 z-50 flex flex-col items-end gap-2"
            aria-live="polite"
          >
            {toasts.map((toast) => {
              return (
                <div
                  key={toast.id}
                  role={toast.variant === 'error' ? 'alert' : 'status'}
                  className="pointer-events-auto w-full max-w-sm rounded-card border border-line bg-surface p-3 text-fg shadow-popover"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-5 items-center ${toastIconTone[toast.variant]}`}
                    >
                      <ToastIcon variant={toast.variant} />
                    </span>
                    <p className="flex-1 text-sm">{toast.message}</p>
                    <IconButton
                      label="Dismiss notification"
                      size="sm"
                      className="-my-1 -mr-1"
                      onClick={() => dismissToast(toast.id)}
                    >
                      <X />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.warn('useToast called without ToastProvider; falling back to no-op.');
    }
    return { showToast: () => {} };
  }
  return context;
}
