import React from 'react';
import { Sun, Moon, Settings, RefreshCw, Loader2, PanelLeft, PanelRight, Plus } from 'lucide-react';
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
  onFocusMessageInput?: () => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  showLeftSidebarButton?: boolean;
  showRightSidebarButton?: boolean;
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
  onFocusMessageInput,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  showLeftSidebarButton = false,
  showRightSidebarButton = false,
  onNewChat,
}: ChatHeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  type Option = { value: string; label: string };
  const defaultOpenAIModels: Option[] = React.useMemo(() => [], []);

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
    <header className="sticky top-0 z-40 bg-white dark:bg-zinc-950 border-b border-zinc-200/50 dark:border-zinc-800/50 backdrop-blur-sm bg-white/80 dark:bg-zinc-950/80">
      <div className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
          {/* Left Sidebar Toggle - Mobile Only */}
          {showLeftSidebarButton && onToggleLeftSidebar && (
            <button
              onClick={onToggleLeftSidebar}
              className="md:hidden w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 transition-colors flex-shrink-0"
              title="Toggle conversation history"
              aria-label="Toggle conversation history"
              type="button"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}

          {/* New Chat Button - Mobile Only */}
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="md:hidden w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 transition-colors flex-shrink-0"
              title="New Chat"
              aria-label="Start new chat"
              type="button"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}

          <ModelSelector
            value={model}
            onChange={onModelChange}
            groups={effectiveGroups}
            fallbackOptions={effectiveFallback}
            className="text-sm sm:text-base md:text-lg"
            ariaLabel="Model"
            onAfterChange={onFocusMessageInput}
          />
          {onRefreshModels && (
            <button
              onClick={onRefreshModels}
              disabled={isLoadingModels}
              className="hidden sm:flex w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 items-center justify-center text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
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

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 transition-colors"
            title="Open settings"
            aria-label="Open settings"
            type="button"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 transition-colors"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            type="button"
          >
            {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <div className="hidden sm:block">
            <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />
          </div>

          {/* Right Sidebar Toggle - Mobile Only */}
          {showRightSidebarButton && onToggleRightSidebar && (
            <button
              onClick={onToggleRightSidebar}
              className="md:hidden w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 transition-colors"
              title="Toggle system prompts"
              aria-label="Toggle system prompts"
              type="button"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
