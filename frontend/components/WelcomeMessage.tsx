import React from 'react';
import { Code, Zap, Lightbulb, HelpCircle } from 'lucide-react';

interface WelcomeMessageProps {
  onSuggestionClick?: (text: string) => void;
}

export function WelcomeMessage({ onSuggestionClick }: WelcomeMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-3xl mx-auto px-6 py-12 animate-in fade-in duration-700">
      {/* Subtle background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-zinc-500/3 rounded-full blur-[100px]" />
      </div>

      {/* Heading */}
      <h1 className="mb-3 text-3xl font-semibold text-zinc-900 dark:text-zinc-200 tracking-tight">
        Welcome to Chat
      </h1>

      <p className="mb-10 text-lg text-zinc-500 dark:text-zinc-400 max-w-md text-center leading-relaxed">
        How can I help you today?
      </p>

      {/* Suggestion Chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        <SuggestionCard
          icon={<Code className="w-4 h-4" />}
          text="Write a new component"
          subtext="Generate clean, modern code"
          onClick={() =>
            onSuggestionClick?.('Write a new React component that displays a user profile card')
          }
        />
        <SuggestionCard
          icon={<Zap className="w-4 h-4" />}
          text="Debug an issue"
          subtext="Find and fix errors quickly"
          onClick={() => onSuggestionClick?.('Help me debug this error: ')}
        />
        <SuggestionCard
          icon={<Lightbulb className="w-4 h-4" />}
          text="Brainstorm ideas"
          subtext="Get creative solutions"
          onClick={() => onSuggestionClick?.('Brainstorm 5 creative ideas for a ')}
        />
        <SuggestionCard
          icon={<HelpCircle className="w-4 h-4" />}
          text="Explain a concept"
          subtext="Understand complex topics"
          onClick={() => onSuggestionClick?.('Explain how React Server Components work')}
        />
      </div>
    </div>
  );
}

interface SuggestionCardProps {
  icon: React.ReactNode;
  text: string;
  subtext: string;
  onClick?: () => void;
}

function SuggestionCard({ icon, text, subtext, onClick }: SuggestionCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-4 p-4 text-left bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/60 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all duration-200"
    >
      <div className="p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors">
        {icon}
      </div>
      <div>
        <div className="font-medium text-zinc-900 dark:text-zinc-200 text-sm group-hover:text-black dark:group-hover:text-zinc-200 transition-colors">
          {text}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">{subtext}</div>
      </div>
    </button>
  );
}
