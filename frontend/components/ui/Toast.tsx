'use client';
import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Info, X, XCircle } from 'lucide-react';

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

function getToastStyles(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return {
        container:
          'border-emerald-200/70 bg-emerald-50/90 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-900/40 dark:text-emerald-100',
        icon: 'text-emerald-600 dark:text-emerald-300',
      };
    case 'error':
      return {
        container:
          'border-red-200/70 bg-red-50/90 text-red-900 dark:border-red-800/70 dark:bg-red-900/40 dark:text-red-100',
        icon: 'text-red-600 dark:text-red-300',
      };
    case 'info':
    default:
      return {
        container:
          'border-zinc-200/70 bg-white/95 text-zinc-900 dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:text-zinc-100',
        icon: 'text-zinc-600 dark:text-zinc-300',
      };
  }
}

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
    return () => {
      timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current.clear();
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
            className="fixed right-4 top-4 z-[10002] flex max-w-[90vw] flex-col gap-2"
            aria-live="polite"
          >
            {toasts.map((toast) => {
              const styles = getToastStyles(toast.variant);
              return (
                <div
                  key={toast.id}
                  role={toast.variant === 'error' ? 'alert' : 'status'}
                  className={`pointer-events-auto w-80 max-w-[90vw] rounded-lg border px-3 py-2 shadow-lg backdrop-blur ${styles.container}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 ${styles.icon}`}>
                      <ToastIcon variant={toast.variant} />
                    </span>
                    <p className="text-sm leading-snug flex-1">{toast.message}</p>
                    <button
                      type="button"
                      onClick={() => dismissToast(toast.id)}
                      aria-label="Dismiss notification"
                      className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
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
