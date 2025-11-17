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
      className={`${collapsed ? 'w-16' : 'w-72'} z-40 p-4 flex flex-col bg-white dark:bg-neutral-950 border-r border-slate-200/70 dark:border-neutral-800/70 transition-[width] duration-300 ease-in-out relative`}
    >
      {/* Collapse/Expand Button */}
      <button
        className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-white dark:bg-neutral-950 border border-slate-200/70 dark:border-neutral-800/70 transition-colors duration-200 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-900 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>

      {collapsed ? (
        // Collapsed state - minimal UI
        <div className="flex flex-col items-center space-y-4">
          <button
            className="w-8 h-8 rounded-full border border-slate-200/70 dark:border-neutral-800/70 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors duration-150 flex items-center justify-center group"
            onClick={onNewChat}
            title="New Chat"
            aria-label="Start new chat"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 text-slate-600 dark:text-slate-400 transition-colors duration-150 disabled:opacity-50 flex items-center justify-center group"
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
          <div className="flex items-center justify-between mb-4">
            <button
              className="text-xs p-1.5 rounded-full bg-transparent hover:bg-slate-100 dark:hover:bg-neutral-900 text-slate-500 dark:text-slate-400 transition-colors duration-150 disabled:opacity-50"
              onClick={onRefresh}
              disabled={loadingConversations}
              title="Refresh"
            >
              <RefreshCw className={`w-3 h-3 ${loadingConversations ? 'animate-spin' : ''}`} />
            </button>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Chat History
            </div>
            <button
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200/70 dark:border-neutral-800/70 hover:bg-slate-50 dark:hover:bg-neutral-900 text-slate-700 dark:text-slate-200 transition-colors duration-150 flex items-center gap-2"
              onClick={onNewChat}
            >
              <Plus className="w-3 h-3" />
              New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 text-sm p-3 rounded-md transition-colors duration-100 cursor-pointer ${conversationId === c.id ? 'bg-slate-50 dark:bg-neutral-900 border border-slate-200/70 dark:border-neutral-800/70' : 'hover:bg-slate-50 dark:hover:bg-neutral-900 border border-transparent'}`}
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
