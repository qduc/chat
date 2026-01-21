import React from 'react';
import { Eye, EyeOff, Save, RefreshCw, Check, XCircle } from 'lucide-react';

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

interface SecretInputCardProps {
  title: string;
  description?: string;
  apiKeyField: SecretField;
  baseUrlField?: SecretField;
  isRevealed: boolean;
  onRevealToggle: () => void;
  isSaving: boolean;
  onSave: () => void | Promise<void>;
  hasChanges: boolean;
  serviceName: string;
}

export default function SecretInputCard({
  title,
  description,
  apiKeyField,
  baseUrlField,
  isRevealed,
  onRevealToggle,
  isSaving,
  onSave,
  hasChanges,
  serviceName,
}: SecretInputCardProps) {
  return (
    <div className="space-y-2 pb-3 border-b border-zinc-200/70 dark:border-zinc-800">
      {/* Label with Saved Badge */}
      {title && (
        <div className="flex items-center gap-2">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {title}
            {apiKeyField.required && <span className="text-red-500">*</span>}
          </label>
          {!hasChanges && apiKeyField.value && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
        </div>
      )}

      {description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{description}</p>
      )}

      {/* Base URL Field (Optional) */}
      {baseUrlField && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {baseUrlField.label}
            </label>
            {!hasChanges && baseUrlField.value && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <input
            type={baseUrlField.type || 'url'}
            autoComplete="off"
            className="w-full px-3 py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
            value={baseUrlField.value || ''}
            onChange={(e) => baseUrlField.onChange(e.target.value)}
            placeholder={baseUrlField.placeholder}
          />
          {baseUrlField.error && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{baseUrlField.error}</span>
            </p>
          )}
          {baseUrlField.helperText && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{baseUrlField.helperText}</p>
          )}
        </div>
      )}

      {/* API Key Field */}
      <div className="space-y-3">
        {!title && (
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {apiKeyField.label}
          </label>
        )}

        <div className="relative">
          <input
            type={isRevealed ? 'text' : 'password'}
            autoComplete="new-password"
            className="w-full px-3 py-2.5 pr-10 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
            value={apiKeyField.value || ''}
            onChange={(e) => apiKeyField.onChange(e.target.value)}
            placeholder={apiKeyField.placeholder}
          />
          <button
            type="button"
            aria-label={isRevealed ? `Hide ${serviceName} API key` : `Show ${serviceName} API key`}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            onClick={onRevealToggle}
          >
            {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {apiKeyField.error && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
            <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{apiKeyField.error}</span>
          </p>
        )}

        {apiKeyField.helperText && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{apiKeyField.helperText}</p>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !hasChanges}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white dark:text-zinc-900 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {isSaving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {!hasChanges ? 'Saved' : 'Save'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
