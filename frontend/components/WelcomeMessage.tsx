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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Main Icon */}
      <div className="mb-8">
        <img src="/logo.png" alt="Logo" className="w-16 h-16 rounded-2xl" />
      </div>

      {/* Heading */}
      <h1 className="mb-3 text-3xl font-semibold text-slate-900 dark:text-white tracking-tight">
        Welcome to Chat
      </h1>

      <p className="mb-10 text-lg text-slate-500 dark:text-slate-400 max-w-md text-center leading-relaxed">
        Your AI coding companion. How can I help you today?
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
      className="group flex items-center gap-4 p-4 text-left bg-white dark:bg-neutral-800/50 border border-slate-200 dark:border-neutral-800 rounded-xl hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all duration-200"
    >
      <div className="p-2 bg-slate-50 dark:bg-neutral-800 rounded-lg text-slate-600 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
        {icon}
      </div>
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-200 text-sm group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
          {text}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">{subtext}</div>
      </div>
    </button>
  );
}
