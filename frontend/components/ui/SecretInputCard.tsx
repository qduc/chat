import React from 'react';
import { Eye, EyeOff, Save, RefreshCw, Check } from 'lucide-react';
import { Button, IconButton } from './Button';
import { Field, Input } from './Input';

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

/** "Saved" status shown next to a field label. Hidden from AT: the Save button already says "Saved". */
function SavedStatus() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1 text-xs text-success">
      <Check className="size-4" />
      Saved
    </span>
  );
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
  const apiKeyLabel = title || apiKeyField.label;
  const showApiKeySaved = Boolean(title) && !hasChanges && Boolean(apiKeyField.value);
  const showBaseUrlSaved = Boolean(baseUrlField) && !hasChanges && Boolean(baseUrlField?.value);

  return (
    <div className="flex flex-col gap-4">
      {description && <p className="text-sm text-fg-muted">{description}</p>}

      {baseUrlField && (
        <Field
          label={baseUrlField.label}
          hint={showBaseUrlSaved ? <SavedStatus /> : undefined}
          description={baseUrlField.helperText}
          error={baseUrlField.error}
        >
          <Input
            type={baseUrlField.type || 'url'}
            autoComplete="off"
            value={baseUrlField.value || ''}
            onChange={(e) => baseUrlField.onChange(e.target.value)}
            placeholder={baseUrlField.placeholder}
          />
        </Field>
      )}

      <Field
        label={apiKeyField.required ? `${apiKeyLabel} *` : apiKeyLabel}
        hint={showApiKeySaved ? <SavedStatus /> : undefined}
        description={apiKeyField.helperText}
        error={apiKeyField.error}
      >
        <div className="relative">
          <Input
            type={isRevealed ? 'text' : 'password'}
            autoComplete="new-password"
            className="pr-8"
            value={apiKeyField.value || ''}
            onChange={(e) => apiKeyField.onChange(e.target.value)}
            placeholder={apiKeyField.placeholder}
          />
          <IconButton
            label={isRevealed ? `Hide ${serviceName} API key` : `Show ${serviceName} API key`}
            size="sm"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            onClick={onRevealToggle}
          >
            {isRevealed ? <EyeOff /> : <Eye />}
          </IconButton>
        </div>
      </Field>

      <Button
        variant="primary"
        className="self-end"
        onClick={onSave}
        disabled={isSaving || !hasChanges}
      >
        {isSaving ? (
          <>
            <RefreshCw className="animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save />
            {!hasChanges ? 'Saved' : 'Save'}
          </>
        )}
      </Button>
    </div>
  );
}
