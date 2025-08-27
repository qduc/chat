import { MessageCircle, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface ChatHeaderProps {
  isStreaming: boolean;
}

export function ChatHeader({
  isStreaming
}: ChatHeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const toggleTheme = () => {
    if (theme === 'dark') {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
            <MessageCircle className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
          <h1 className="font-semibold text-xl text-slate-800 dark:text-slate-200">Chat</h1>
        </div>

        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          )}
        </button>
      </div>
    </header>
  );
}
