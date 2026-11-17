import {
  Trash2,
  Loader2,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { version } from '../package.json';
import type { ConversationMeta } from '../lib';
import { cn } from '../lib/cn';
import { Button, IconButton } from './ui/Button';
import { Input } from './ui/Input';
import { Logo } from './ui/Logo';

interface ChatSidebarProps {
  conversations: ConversationMeta[];
  nextCursor: string | null;
  loadingConversations: boolean;
  conversationId: string | null;
  collapsed: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  unsavedPlaceholder?: boolean;
}

export function ChatSidebar({
  conversations,
  nextCursor,
  loadingConversations,
  conversationId,
  collapsed,
  onSelectConversation,
  onDeleteConversation,
  onLoadMore,
  onRefresh,
  onNewChat,
  onToggleCollapse,
  searchQuery = '',
  onSearch,
  unsavedPlaceholder,
}: ChatSidebarProps) {
  return (
    <aside
      aria-label="Conversation history"
      className={cn(
        'relative z-40 flex h-full flex-col border-r border-line bg-canvas-subtle md:transition-[width]',
        collapsed ? 'w-16 items-center gap-2 px-2 py-3' : 'w-72 gap-4 p-3 sm:w-80'
      )}
    >
      {collapsed ? (
        // Collapsed state - minimal UI
        <>
          <Logo label="Logo" className="my-1" />

          {/* Expand button - Desktop only */}
          <IconButton
            label="Expand sidebar"
            title="Expand sidebar"
            onClick={onToggleCollapse}
            className="hidden md:inline-flex"
          >
            <ChevronRight />
          </IconButton>

          <IconButton label="Start new chat" title="New Chat" onClick={onNewChat}>
            <Plus />
          </IconButton>

          <IconButton
            label="Refresh conversation list"
            title="Refresh conversations"
            onClick={onRefresh}
            disabled={loadingConversations}
          >
            <RefreshCw className={loadingConversations ? 'animate-spin' : undefined} />
          </IconButton>

          <IconButton
            label="Search conversations"
            title="Search conversations"
            onClick={onToggleCollapse}
          >
            <Search />
          </IconButton>

          {(conversations.length > 0 || conversationId) && (
            <div aria-hidden="true" className="my-1 h-px w-8 bg-line" />
          )}

          {conversations.length > 0 && (
            <div
              className="flex h-8 w-9 items-center justify-center rounded-control bg-muted text-xs text-fg-muted"
              title={`${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
            >
              {conversations.length > 99 ? '99+' : conversations.length}
            </div>
          )}

          {conversationId && (
            <div className="size-2 rounded-full bg-accent" title="Active conversation"></div>
          )}
        </>
      ) : (
        // Expanded state - full UI
        <>
          <div className="flex items-center justify-between gap-2 pl-1">
            <div className="flex items-center gap-2">
              <Logo label="Logo" />
              <span className="text-base font-medium text-fg">Chat</span>
            </div>
            <div className="flex items-center">
              <IconButton
                label="Refresh history"
                title="Refresh history"
                size="sm"
                onClick={onRefresh}
                disabled={loadingConversations}
              >
                <RefreshCw className={loadingConversations ? 'animate-spin' : undefined} />
              </IconButton>
              <IconButton label="New Chat" title="New Chat" size="sm" onClick={onNewChat}>
                <Plus />
              </IconButton>
              {/* Collapse button - Desktop only */}
              <IconButton
                label="Collapse sidebar"
                title="Collapse sidebar"
                size="sm"
                onClick={onToggleCollapse}
                className="hidden md:inline-flex"
              >
                <ChevronLeft />
              </IconButton>
            </div>
          </div>

          {onSearch && (
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              />
              <Input
                type="text"
                aria-label="Search conversations"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => onSearch(e.target.value)}
                className="pr-8 pl-8"
              />
              {searchQuery && (
                <IconButton
                  label="Clear search"
                  title="Clear search"
                  size="sm"
                  onClick={() => onSearch('')}
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                >
                  <X />
                </IconButton>
              )}
            </div>
          )}

          <nav
            aria-label="Conversations"
            className="scrollbar-thin -mx-1 flex flex-1 flex-col gap-1 overflow-y-auto px-1"
          >
            {unsavedPlaceholder && (
              <div
                className="flex cursor-default items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-2 text-sm focus-ring"
                tabIndex={0}
                role="button"
                aria-label="Unsaved fork"
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent"></span>
                <span className="flex-1 truncate text-fg-muted italic">Unsaved fork</span>
              </div>
            )}
            {searchQuery && conversations.length === 0 && !loadingConversations && (
              <p className="px-4 py-8 text-center text-sm text-fg-muted">
                No conversations found for &quot;{searchQuery}&quot;
              </p>
            )}
            {conversations.map((c) => {
              const isActive = conversationId === c.id && !unsavedPlaceholder;
              return (
                <div
                  key={c.id}
                  className={cn(
                    'group relative flex items-center rounded-control transition-colors',
                    isActive ? 'bg-emphasis' : 'hover:bg-muted'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(c.id)}
                    aria-label={c.title || 'Untitled conversation'}
                    aria-current={isActive ? 'true' : undefined}
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control pr-8 pl-3 text-left text-sm touch-target focus-ring-inset"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        isActive ? 'bg-accent' : 'bg-line-strong'
                      )}
                    />
                    <span
                      className={cn('flex-1 truncate', isActive ? 'text-fg' : 'text-fg-muted')}
                      title={c.title || c.id}
                    >
                      {c.title || 'Untitled conversation'}
                    </span>
                  </button>
                  <IconButton
                    label="Delete conversation"
                    title="Delete conversation"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${c.title || 'Untitled conversation'}"?`)) {
                        onDeleteConversation(c.id);
                      }
                    }}
                    className="absolute right-1 size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-danger pointer-coarse:opacity-100"
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              );
            })}
          </nav>

          {nextCursor && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={onLoadMore}
              disabled={loadingConversations}
            >
              {loadingConversations ? (
                <>
                  <Loader2 className="animate-spin" />
                  Loading...
                </>
              ) : (
                'Load more conversations'
              )}
            </Button>
          )}
          <p className="border-t border-line pt-3 text-center text-xs text-fg-subtle">v{version}</p>
        </>
      )}
    </aside>
  );
}
