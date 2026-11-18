import React from 'react';
import { Sun, Moon, Settings, PanelLeft, PanelRight, Plus } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ModelSelector, { type Group as TabGroup } from './ui/ModelSelector';
import { AuthButton } from './auth/AuthButton';
import { IconButton } from './ui/Button';
import { cn } from '../lib/cn';
import { sidebarShortcut, useModKey } from '../lib/shortcuts';

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
  /** Whether the chat details panel is open (drives the toggle's pressed state). */
  rightSidebarOpen?: boolean;
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
  rightSidebarOpen = false,
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
  const { user } = useAuth();

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

  const modKey = useModKey();
  const historyShortcut = sidebarShortcut(modKey, 'history');
  const detailsShortcut = sidebarShortcut(modKey, 'details');

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
              title={`Toggle conversation history (${historyShortcut})`}
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
            onRefresh={onRefreshModels}
            isRefreshing={isLoadingModels}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Open settings" title="Open settings" onClick={onOpenSettings}>
            <Settings />
          </IconButton>
          {/* Signed-in users switch theme from the user menu. */}
          {!user && (
            <IconButton
              label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            </IconButton>
          )}
          <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />

          {/* Chat details panel toggle */}
          {showRightSidebarButton && onToggleRightSidebar && (
            <IconButton
              label="Chat details"
              title={`${rightSidebarOpen ? 'Hide' : 'Show'} chat details (${detailsShortcut})`}
              aria-pressed={rightSidebarOpen}
              onClick={onToggleRightSidebar}
              className={cn(
                // The hit area runs out to the header's top and right edges, so
                // flicking the pointer into the corner lands on it.
                'relative before:absolute before:-top-2 before:-right-2 before:-bottom-2 before:-left-1',
                'sm:before:-right-4 md:before:-right-6',
                rightSidebarOpen && 'bg-muted text-fg'
              )}
            >
              <PanelRight />
            </IconButton>
          )}
        </div>
      </div>
    </header>
  );
}
