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

export function ChatHeader({
  model,
  onModelChange,
  onProviderChange,
  onOpenSettings,
  onShowLogin,
  onShowRegister,
  onRefreshModels,
  isLoadingModels = false,
  groups,
  fallbackOptions,
  modelToProvider,
}: ChatHeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  type Option = { value: string; label: string };
  const defaultOpenAIModels: Option[] = React.useMemo(
    () => [
      { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
    ],
    []
  );

  const effectiveGroups =
    groups && groups.length > 0
      ? groups
      : fallbackOptions
        ? [{ id: 'default', label: 'Models', options: fallbackOptions }]
        : [{ id: 'default', label: 'Models', options: defaultOpenAIModels }];
  const effectiveFallback = fallbackOptions ?? defaultOpenAIModels;

  const lastProviderIdRef = React.useRef<string | undefined>(undefined);

  // Notify parent when provider changes based on selected model
  React.useEffect(() => {
    if (!onProviderChange) return;

    let providerId: string | undefined;

    // First try to extract provider from qualified model ID (provider::model)
    if (model.includes('::')) {
      providerId = model.split('::')[0];
    } else if (modelToProvider) {
      // Fallback to modelToProvider map for legacy model IDs
      if (modelToProvider instanceof Map) {
        providerId = modelToProvider.get(model) as string | undefined;
      } else {
        providerId = (modelToProvider as Record<string, string>)[model];
      }
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
    <header className="sticky top-0 z-40 bg-white dark:bg-neutral-950 border-b border-slate-200/70 dark:border-neutral-800/70">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
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
              className="w-8 h-8 rounded-md border border-slate-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 hover:bg-slate-50 dark:hover:bg-neutral-800 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh model list"
              aria-label="Refresh model list"
              type="button"
            >
              {isLoadingModels ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-md border border-slate-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 hover:bg-slate-50 dark:hover:bg-neutral-800 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
            title="Open settings"
            aria-label="Open settings"
            type="button"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-md border border-slate-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 hover:bg-slate-50 dark:hover:bg-neutral-800 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            type="button"
          >
            {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />
        </div>
      </div>
    </header>
  );
}
