import type { ConversationMeta } from '../lib/chat';

interface ChatSidebarProps {
  conversations: ConversationMeta[];
  nextCursor: string | null;
  loadingConversations: boolean;
  conversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}

export function ChatSidebar({
  conversations,
  nextCursor,
  loadingConversations,
  conversationId,
  onSelectConversation,
  onDeleteConversation,
  onLoadMore,
  onRefresh
}: ChatSidebarProps) {
  return (
    <aside className="w-72 p-4 flex flex-col border-r border-slate-200/60 dark:border-neutral-800/60 bg-white/40 dark:bg-neutral-950/40 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">Chat History</div>
        <button
          className="text-xs px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400 transition-colors duration-200"
          onClick={onRefresh}
        >
          ↻ Refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
        {conversations.map(c => (
          <div key={c.id} className={`group flex items-center gap-2 text-sm p-3 rounded-lg transition-all duration-200 hover:shadow-sm ${conversationId === c.id ? 'bg-slate-100 dark:bg-neutral-900/40 border border-slate-200/50 dark:border-neutral-700/50 shadow-sm' : 'bg-white/60 dark:bg-neutral-900/60 hover:bg-white/80 dark:hover:bg-neutral-900/80 border border-transparent'}`}>
            <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-500 dark:group-hover:bg-slate-400 transition-colors duration-200"></div>
            <button 
              className="flex-1 text-left truncate text-slate-700 dark:text-slate-300" 
              onClick={() => onSelectConversation(c.id)} 
              title={c.title || c.id}
            >
              {c.title || 'Untitled conversation'}
            </button>
            <button 
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-all duration-200 p-1 hover:bg-slate-100 dark:hover:bg-neutral-900/30 rounded" 
              title="Delete conversation" 
              onClick={() => onDeleteConversation(c.id)}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
        {conversations.length === 0 && !loadingConversations && (
          <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8 bg-white/40 dark:bg-neutral-900/40 rounded-lg border border-dashed border-slate-300 dark:border-neutral-700">
            <div className="mb-2">💬</div>
            <div>No conversations yet</div>
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-neutral-800/60">
        {nextCursor && (
          <button 
            className="w-full text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-colors duration-200 disabled:opacity-50" 
            onClick={onLoadMore} 
            disabled={loadingConversations}
          >
            {loadingConversations ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </span>
            ) : 'Load more conversations'}
          </button>
        )}
      </div>
    </aside>
  );
}