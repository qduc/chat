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
      className={`
        ${collapsed ? 'w-16' : 'w-72 md:w-72'}
        h-full z-40 p-4 flex flex-col bg-slate-50 dark:bg-neutral-900
        md:transition-[width] md:duration-300 md:ease-in-out
        relative
        ${!collapsed ? 'w-72 sm:w-80' : ''}
      `}
    >
      {/* Collapse/Expand Button - Desktop only */}
      <button
        className="hidden md:flex absolute -right-3 top-6 w-6 h-6 rounded-full bg-white dark:bg-neutral-950 border border-slate-200/70 dark:border-neutral-800/70 transition-colors duration-200 items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-900 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>

      {collapsed ? (
        // Collapsed state - minimal UI
        <div className="flex flex-col items-center space-y-4">
          <div className="mb-2">
            <img src="/logo.svg" alt="Logo" className="w-8 h-8 rounded-xl" />
          </div>
          <button
            className="w-8 h-8 rounded-full border border-slate-200/70 dark:border-neutral-800/70 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors duration-150 flex items-center justify-center group cursor-pointer"
            onClick={onNewChat}
            title="New Chat"
            aria-label="Start new chat"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 text-slate-600 dark:text-slate-400 transition-colors duration-150 disabled:opacity-50 flex items-center justify-center group cursor-pointer"
            onClick={onRefresh}
            disabled={loadingConversations}
            title="Refresh conversations"
            aria-label="Refresh conversation list"
          >
            <RefreshCw className={`w-4 h-4 ${loadingConversations ? 'animate-spin' : ''}`} />
          </button>
          {/* Show conversation count when collapsed */}
          {conversations.length > 0 && (
            <div
              className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-neutral-800 rounded-full w-6 h-6 flex items-center justify-center"
              title={`${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
            >
              {conversations.length > 99 ? '99+' : conversations.length}
            </div>
          )}
          {/* Show active conversation indicator */}
          {conversationId && (
            <div
              className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 pulse"
              title="Active conversation"
            ></div>
          )}
        </div>
      ) : (
        // Expanded state - full UI
        <>
            <div className="flex items-center justify-between mb-6 px-1">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="Logo" className="w-8 h-8 rounded-xl" />
                <span className="font-bold text-lg text-slate-800 dark:text-slate-100 tracking-tight">
                  Chat
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-1.5 rounded-md hover:bg-slate-200/50 dark:hover:bg-neutral-800 text-slate-500 dark:text-slate-400 transition-colors"
                  onClick={onRefresh}
                  disabled={loadingConversations}
                  title="Refresh history"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingConversations ? 'animate-spin' : ''}`} />
                </button>
                <button
                  className="p-1.5 rounded-md hover:bg-slate-200/50 dark:hover:bg-neutral-800 text-slate-500 dark:text-slate-400 transition-colors"
                  onClick={onNewChat}
                  title="New Chat"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 text-sm p-3 rounded-md transition-all duration-200 cursor-pointer ${conversationId === c.id ? 'bg-white dark:bg-neutral-800' : 'hover:bg-slate-200/50 dark:hover:bg-neutral-800/50'}`}
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
                          ? 'bg-slate-500 dark:bg-slate-400'
                          : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                ></div>
                <div
                  className="flex-1 text-left truncate text-slate-700 dark:text-slate-300"
                  title={c.title || c.id}
                >
                  {c.title || 'Untitled conversation'}
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-150 p-1 hover:bg-slate-100 dark:hover:bg-neutral-900 rounded"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-neutral-800/60">
            {nextCursor && (
              <button
                className="w-full text-sm px-4 py-2 rounded-md bg-slate-50 hover:bg-slate-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 text-slate-700 dark:text-slate-200 transition-colors duration-150 disabled:opacity-50"
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
