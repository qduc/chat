import React from 'react';
import { Sun, Moon, Settings, RefreshCw, Loader2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import ModelSelector from './ui/ModelSelector';
import { type Group as TabGroup } from './ui/TabbedSelect';
import { AuthButton } from './auth/AuthButton';

interface ChatHeaderProps {
  isStreaming: boolean;
  onNewChat?: () => void;
  model: string;
  onModelChange: (model: string) => void;
  onProviderChange?: (providerId: string) => void;
  onOpenSettings?: () => void;
  onShowLogin?: () => void;
  onShowRegister?: () => void;
  onRefreshModels?: () => void;
  isLoadingModels?: boolean;
  groups?: TabGroup[] | null;
  fallbackOptions?: { value: string; label: string }[];
  modelToProvider?: Record<string, string> | Map<string, string>;
}

export function ChatHeader({ model, onModelChange, onProviderChange, onOpenSettings, onShowLogin, onShowRegister, onRefreshModels, isLoadingModels = false, groups, fallbackOptions, modelToProvider }: ChatHeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  type Option = { value: string; label: string };
  const defaultOpenAIModels: Option[] = React.useMemo(() => ([
    { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' }
  ]), []);

  const effectiveGroups = groups ?? (fallbackOptions ? [{ id: 'default', label: 'Models', options: fallbackOptions }] : [{ id: 'default', label: 'Models', options: defaultOpenAIModels }]);
  const effectiveFallback = fallbackOptions ?? defaultOpenAIModels;

  const lastProviderIdRef = React.useRef<string | undefined>(undefined);

  // Notify parent when provider changes based on selected model
  React.useEffect(() => {
    if (!modelToProvider || !onProviderChange) return;
    let providerId: string | undefined;
    if (modelToProvider instanceof Map) {
      providerId = modelToProvider.get(model) as string | undefined;
    } else {
      providerId = (modelToProvider as Record<string, string>)[model];
    }
    if (!providerId) {
      lastProviderIdRef.current = undefined;
      return;
    }
    if (lastProviderIdRef.current === providerId) {
      return;
    }
    lastProviderIdRef.current = providerId;
    onProviderChange(providerId);
  }, [model, modelToProvider, onProviderChange]);


  const toggleTheme = () => {
    if (theme === 'dark') {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-neutral-900/95">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ModelSelector
            value={model}
            onChange={onModelChange}
            groups={effectiveGroups}
            fallbackOptions={effectiveFallback}
            className="text-lg"
            ariaLabel="Model"
          />
          {onRefreshModels && (
            <button
              onClick={onRefreshModels}
              disabled={isLoadingModels}
              className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh model list"
              aria-label="Refresh model list"
              type="button"
            >
              {isLoadingModels ? (
                <Loader2 className="w-4 h-4 text-slate-600 dark:text-slate-300 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              )}
            </button>
          )}
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
          <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />
        </div>
      </div>
    </header>
  );
}
