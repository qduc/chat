import React from 'react';
import { ChevronDown, ExternalLink, Check } from 'lucide-react';
import SecretInputCard from './SecretInputCard';

interface SecretField {
  label: string;
  placeholder: string;
  helperText?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: 'password' | 'url' | 'text';
}

interface SearchEngineCardProps {
  name: string;
  description: string;
  docsUrl: string;
  apiKeyField: SecretField;
  baseUrlField?: SecretField;
  isRevealed: boolean;
  onRevealToggle: () => void;
  isSaving: boolean;
  onSave: () => void | Promise<void>;
  hasChanges: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export default function SearchEngineCard({
  name,
  description,
  docsUrl,
  apiKeyField,
  baseUrlField,
  isRevealed,
  onRevealToggle,
  isSaving,
  onSave,
  hasChanges,
  isExpanded,
  onToggleExpand,
}: SearchEngineCardProps) {
  const isConfigured = !!apiKeyField.value;

  return (
    <div className="border-b border-zinc-200/70 dark:border-zinc-800 last:border-b-0">
      {/* Collapsed Header - Clickable to expand */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between gap-3 py-3 px-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors text-left group"
        aria-expanded={isExpanded}
        type="button"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Status indicator circle */}
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isConfigured ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          />

          {/* Engine name */}
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {name}
          </span>
        </div>

        {/* Status label and chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isConfigured && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
              <Check className="w-3 h-3" />
              Configured
            </div>
          )}
          {!isConfigured && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Not configured</span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-zinc-400 dark:text-zinc-600 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 py-4 bg-zinc-50/50 dark:bg-zinc-900/30 border-t border-zinc-200/70 dark:border-zinc-800 space-y-4">
          {/* Description and Link */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{description}</p>
            </div>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors flex-shrink-0 mt-0.5"
              title={`View ${name} documentation`}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Form Fields */}
          <SecretInputCard
            title={baseUrlField ? '' : 'API Key'}
            apiKeyField={apiKeyField}
            baseUrlField={baseUrlField}
            isRevealed={isRevealed}
            onRevealToggle={onRevealToggle}
            isSaving={isSaving}
            onSave={onSave}
            hasChanges={hasChanges}
            serviceName={name}
          />
        </div>
      )}
    </div>
  );
}
