import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Input';

interface SaveAsModalProps {
  isOpen: boolean;
  initialName: string;
  content: string;
  existingNames: string[];
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

const FORM_ID = 'save-as-form';

export default function SaveAsModal({
  isOpen,
  initialName,
  content,
  existingNames,
  onSave,
  onCancel,
}: SaveAsModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate unique name by adding (1), (2), etc.
  const generateUniqueName = useCallback(
    (baseName: string): string => {
      if (!existingNames.includes(baseName)) {
        return baseName;
      }

      let counter = 1;
      let uniqueName = `${baseName} (${counter})`;
      while (existingNames.includes(uniqueName)) {
        counter++;
        uniqueName = `${baseName} (${counter})`;
      }
      return uniqueName;
    },
    [existingNames]
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const uniqueName = generateUniqueName(initialName);
      setName(uniqueName);
      setError('');
      setSaving(false);
      // Focus and select the name after the dialog renders
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, initialName, generateUniqueName]);

  const validateName = (nameValue: string): string => {
    if (!nameValue.trim()) {
      return 'Name is required';
    }
    if (nameValue.length > 255) {
      return 'Name must be 255 characters or less';
    }
    if (existingNames.includes(nameValue.trim())) {
      return 'A prompt with this name already exists';
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const validationError = validateName(trimmedName);

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const success = await onSave(trimmedName);
      if (!success) {
        setError('Failed to save prompt. Please try again.');
      }
    } catch {
      setError('An error occurred while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (error) {
      setError('');
    }
  };

  const handleClose = () => {
    if (!saving) onCancel();
  };

  const isValid = name.trim() && !validateName(name.trim());

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title="Save as New Prompt"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={!isValid || saving}>
            {saving ? 'Creating...' : 'Create Prompt'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">Create a new prompt with the current content.</p>

        <Field
          label="Prompt Name"
          description={`${name.length}/255 characters`}
          error={error || undefined}
        >
          <Input
            ref={inputRef}
            type="text"
            value={name}
            onChange={handleNameChange}
            placeholder="Enter prompt name"
            maxLength={255}
            disabled={saving}
          />
        </Field>

        <section aria-labelledby="save-as-preview-label" className="flex flex-col gap-2">
          <h3 id="save-as-preview-label" className="text-sm font-medium text-fg">
            Content Preview
          </h3>
          <div className="max-h-32 overflow-y-auto rounded-control border border-line bg-canvas-subtle p-3 text-sm whitespace-pre-wrap text-fg-muted">
            {content.length > 200
              ? `${content.substring(0, 200)}...`
              : content || '(Empty content)'}
          </div>
          <p className="text-right text-xs text-fg-subtle">{content.length} characters total</p>
        </section>
      </form>
    </Modal>
  );
}
