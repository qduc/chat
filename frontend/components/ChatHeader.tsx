import { MessageCircle, Plus } from 'lucide-react';
import HeaderButton from './ui/HeaderButton';

interface ChatHeaderProps {
  isStreaming: boolean;
  onNewChat: () => void;
}

export function ChatHeader({
  isStreaming,
  onNewChat
}: ChatHeaderProps) {

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
            <MessageCircle className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
          <h1 className="font-semibold text-xl text-slate-800 dark:text-slate-200">Chat</h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <HeaderButton onClick={onNewChat}>
            <Plus className="w-4 h-4" />
            New Chat
          </HeaderButton>
          {/* Stop button removed from header — streaming control moved to input */}
        </div>
      </div>
    </header>
  );
}
