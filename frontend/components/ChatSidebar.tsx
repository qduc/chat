import { Trash2, Loader2, Plus, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ConversationMeta } from '../lib';

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
}: ChatSidebarProps) {
  return (
    <aside
      aria-label="Conversation history"
      className={`
        ${collapsed ? 'w-16' : 'w-72 md:w-72'}
        h-full z-40 p-4 flex flex-col bg-slate-50 dark:bg-zinc-950 border-r border-zinc-200/50 dark:border-zinc-800/50
        md:transition-[width] md:duration-300 md:ease-in-out
        relative
        ${!collapsed ? 'w-72 sm:w-80' : ''}
      `}
    >
      {collapsed ? (
        // Collapsed state - minimal UI
        <div className="flex flex-col items-center space-y-3 pt-2">
          {/* Logo */}
          <div className="mb-1">
            <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-xl" />
          </div>

          {/* Expand button - Desktop only */}
          <button
            className="hidden md:flex w-10 h-10 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors items-center justify-center text-zinc-500 dark:text-zinc-400 cursor-pointer"
            onClick={onToggleCollapse}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* New Chat button */}
          <button
            className="w-10 h-10 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center text-zinc-500 dark:text-zinc-400 cursor-pointer"
            onClick={onNewChat}
            title="New Chat"
            aria-label="Start new chat"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Refresh button */}
          <button
            className="w-10 h-10 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-zinc-500 dark:text-zinc-400 cursor-pointer"
            onClick={onRefresh}
            disabled={loadingConversations}
            title="Refresh conversations"
            aria-label="Refresh conversation list"
          >
            <RefreshCw className={`w-4 h-4 ${loadingConversations ? 'animate-spin' : ''}`} />
          </button>

          {/* Divider */}
          {(conversations.length > 0 || conversationId) && (
            <div className="w-8 h-px bg-zinc-200 dark:bg-zinc-800 my-1" />
          )}

          {/* Show conversation count when collapsed */}
          {conversations.length > 0 && (
            <div
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-10 h-8 flex items-center justify-center"
              title={`${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
            >
              {conversations.length > 99 ? '99+' : conversations.length}
            </div>
          )}

          {/* Show active conversation indicator */}
          {conversationId && (
            <div
              className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-400 animate-pulse"
              title="Active conversation"
            ></div>
          )}
        </div>
      ) : (
        // Expanded state - full UI
        <>
          <div className="flex items-center justify-between mb-6 px-1">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-xl" />
              <span className="font-bold text-lg text-zinc-800 dark:text-zinc-100 tracking-tight">
                Chat
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                onClick={onRefresh}
                disabled={loadingConversations}
                title="Refresh history"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loadingConversations ? 'animate-spin' : ''}`}
                />
              </button>
              <button
                className="p-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                onClick={onNewChat}
                title="New Chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              {/* Collapse button - Desktop only */}
              <button
                className="hidden md:flex p-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors items-center justify-center"
                onClick={onToggleCollapse}
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 text-sm p-3 rounded-lg transition-all duration-200 cursor-pointer ${conversationId === c.id ? 'bg-white dark:bg-zinc-800/80 shadow-sm' : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'}`}
                onClick={() => onSelectConversation(c.id)}
                tabIndex={0}
                role="button"
                aria-label={c.title || 'Untitled conversation'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectConversation(c.id);
                  }
                }}
              >
                <div
                  className={`w-2 h-2 rounded-full transition-colors duration-200
                      ${
                        conversationId === c.id
                          ? 'bg-zinc-500 dark:bg-zinc-400'
                          : 'bg-zinc-300 dark:bg-zinc-700'
                      }`}
                ></div>
                <div
                  className="flex-1 text-left truncate text-zinc-700 dark:text-zinc-300 font-medium"
                  title={c.title || c.id}
                >
                  {c.title || 'Untitled conversation'}
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150 p-1 hover:bg-zinc-200 dark:hover:bg-zinc-900 rounded"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-200/60 dark:border-zinc-800/60">
            {nextCursor && (
              <button
                className="w-full text-sm px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors duration-150 disabled:opacity-50"
                onClick={onLoadMore}
                disabled={loadingConversations}
              >
                {loadingConversations ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  'Load more conversations'
                )}
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
