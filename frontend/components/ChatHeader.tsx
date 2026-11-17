import React from 'react';
import { Sun, Moon, Settings, RefreshCw, Loader2, PanelLeft, PanelRight, Plus } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import ModelSelector, { type Group as TabGroup } from './ui/ModelSelector';
import { AuthButton } from './auth/AuthButton';
import { IconButton } from './ui/Button';

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
  modelSelectorOpen?: boolean;
  onModelSelectorOpenChange?: (open: boolean) => void;
  onFocusMessageInput?: () => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  showLeftSidebarButton?: boolean;
  showRightSidebarButton?: boolean;
  selectedComparisonModels?: string[];
  onComparisonModelsChange?: (models: string[]) => void;
  comparisonLocked?: boolean;
  comparisonLockReason?: string;
  modelSelectionLocked?: boolean;
  modelSelectionLockReason?: string;
}

const EMPTY_STRING_ARRAY: string[] = [];

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
  modelSelectorOpen,
  onModelSelectorOpenChange,
  onFocusMessageInput,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  showLeftSidebarButton = false,
  showRightSidebarButton = false,
  onNewChat,
  selectedComparisonModels = EMPTY_STRING_ARRAY,
  onComparisonModelsChange,
  comparisonLocked = false,
  comparisonLockReason = 'Model comparison is locked after the first message.',
  modelSelectionLocked = false,
  modelSelectionLockReason = 'Primary model is locked after comparison starts.',
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
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Left Sidebar Toggle - Mobile Only */}
          {showLeftSidebarButton && onToggleLeftSidebar && (
            <IconButton
              label="Toggle conversation history"
              title="Toggle conversation history"
              onClick={onToggleLeftSidebar}
              className="md:hidden"
            >
              <PanelLeft />
            </IconButton>
          )}

          {/* New Chat Button - Mobile Only */}
          {onNewChat && (
            <IconButton
              label="Start new chat"
              title="New Chat"
              onClick={onNewChat}
              className="md:hidden"
            >
              <Plus />
            </IconButton>
          )}

          <ModelSelector
            value={model}
            onChange={onModelChange}
            groups={effectiveGroups}
            fallbackOptions={effectiveFallback}
            className="min-w-0 flex-1 sm:flex-none"
            ariaLabel="Model"
            onAfterChange={onFocusMessageInput}
            disabled={modelSelectionLocked}
            disabledReason={modelSelectionLockReason}
            isOpen={modelSelectorOpen}
            onOpenChange={onModelSelectorOpenChange}
            selectedComparisonModels={selectedComparisonModels}
            onComparisonModelsChange={onComparisonModelsChange}
            comparisonDisabled={comparisonLocked}
            comparisonDisabledReason={comparisonLockReason}
          />
          {onRefreshModels && (
            <IconButton
              label="Refresh model list"
              title="Refresh model list"
              onClick={onRefreshModels}
              disabled={isLoadingModels}
              className="hidden sm:inline-flex"
            >
              {isLoadingModels ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </IconButton>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Open settings" title="Open settings" onClick={onOpenSettings}>
            <Settings />
          </IconButton>
          <IconButton
            label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={toggleTheme}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
          </IconButton>
          <div className="hidden sm:block">
            <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />
          </div>

          {/* Right Sidebar Toggle - Mobile Only */}
          {showRightSidebarButton && onToggleRightSidebar && (
            <IconButton
              label="Toggle system prompts"
              title="Toggle system prompts"
              onClick={onToggleRightSidebar}
              className="md:hidden"
            >
              <PanelRight />
            </IconButton>
          )}
        </div>
      </div>
    </header>
  );
}
