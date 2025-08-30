import { Sun, Moon, Settings } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import IconSelect from './ui/IconSelect';

interface ChatHeaderProps {
  isStreaming: boolean;
  onNewChat?: () => void;
  model: string;
  onModelChange: (model: string) => void;
  onOpenSettings?: () => void;
}

export function ChatHeader({ model, onModelChange, onOpenSettings }: ChatHeaderProps) {
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
          <div className="flex items-center gap-4">
            <IconSelect
              ariaLabel="Model"
              value={model}
              onChange={onModelChange}
              className="text-lg py-1 px-2"
              options={[
                { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
                { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                { value: 'gpt-4o', label: 'GPT-4o' }
              ]}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
            title="Open settings"
            aria-label="Open settings"
            type="button"
          >
            <Settings className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </button>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            type="button"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
