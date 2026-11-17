import React from 'react';
import { Code, Zap, Lightbulb, HelpCircle } from 'lucide-react';

interface WelcomeMessageProps {
  onSuggestionClick?: (text: string) => void;
}

export function WelcomeMessage({ onSuggestionClick }: WelcomeMessageProps) {
  return (
    <div className="mx-auto flex min-h-120 max-w-3xl flex-col items-center justify-center px-6 py-8">
      <h1 className="mb-2 text-xl font-medium text-fg">Welcome to Chat</h1>

      <p className="mb-8 max-w-md text-center text-base text-fg-muted">How can I help you today?</p>

      {/* Suggestions: equal-priority tiles */}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <SuggestionCard
          icon={<Code />}
          text="Write a new component"
          subtext="Generate clean, modern code"
          onClick={() =>
            onSuggestionClick?.('Write a new React component that displays a user profile card')
          }
        />
        <SuggestionCard
          icon={<Zap />}
          text="Debug an issue"
          subtext="Find and fix errors quickly"
          onClick={() => onSuggestionClick?.('Help me debug this error: ')}
        />
        <SuggestionCard
          icon={<Lightbulb />}
          text="Brainstorm ideas"
          subtext="Get creative solutions"
          onClick={() => onSuggestionClick?.('Brainstorm 5 creative ideas for a ')}
        />
        <SuggestionCard
          icon={<HelpCircle />}
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
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 rounded-card border border-line p-4 text-left transition-colors hover:bg-muted focus-ring"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-control border border-line text-fg-muted [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{text}</span>
        <span className="text-xs text-fg-subtle">{subtext}</span>
      </span>
    </button>
  );
}
