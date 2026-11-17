import React from 'react';
import { ChevronDown, ExternalLink, Check } from 'lucide-react';
import SecretInputCard from './SecretInputCard';
import { iconButtonClasses } from './Button';
import { cn } from '../../lib/cn';

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
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted touch-target focus-ring-inset"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              isConfigured ? 'bg-success' : 'bg-line-strong'
            )}
          />
          <span className="truncate text-sm font-medium text-fg">{name}</span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {isConfigured ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check aria-hidden="true" className="size-4" />
              Configured
            </span>
          ) : (
            <span className="text-xs text-fg-subtle">Not configured</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 text-fg-subtle', isExpanded && 'rotate-180')}
          />
        </span>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-fg-muted">{description}</p>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={iconButtonClasses({ size: 'sm', className: 'size-7' })}
              title={`View ${name} documentation`}
              aria-label={`View ${name} documentation`}
            >
              <ExternalLink />
            </a>
          </div>

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
