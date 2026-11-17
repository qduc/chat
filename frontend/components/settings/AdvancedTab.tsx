'use client';

import React from 'react';
import {
  Check,
  RefreshCw,
  Save,
  XCircle,
  Plus,
  Trash2,
  Edit2,
  X,
  Code,
  Copy,
  CopyPlus,
} from 'lucide-react';
import ModelSelector from '../ui/ModelSelector';
import { Button, IconButton } from '../ui/Button';
import { Field, Input, Textarea } from '../ui/Input';
import { httpClient } from '../../lib';
import { useToast } from '../ui/Toast';

interface AdvancedTabProps {
  isVisible: boolean;
  isOpen: boolean;
  modelGroups: any[] | null;
  modelOptions: any[];
  onSettingsChanged?: () => void;
}

interface CustomParamPreset {
  id: string;
  label: string;
  params: Record<string, any>;
}

export default function AdvancedTab({
  isVisible,
  isOpen,
  modelGroups,
  modelOptions,
  onSettingsChanged,
}: AdvancedTabProps) {
  const { showToast } = useToast();

  const [maxToolIterations, setMaxToolIterations] = React.useState<string>('10');
  const [maxToolIterationsSaving, setMaxToolIterationsSaving] = React.useState(false);
  const [maxToolIterationsError, setMaxToolIterationsError] = React.useState<string | null>(null);
  const [initialMaxToolIterations, setInitialMaxToolIterations] = React.useState<string>('10');

  const [choreModel, setChoreModel] = React.useState<string>('');
  const [initialChoreModel, setInitialChoreModel] = React.useState<string>('');
  const [choreModelSaving, setChoreModelSaving] = React.useState(false);
  const [choreModelError, setChoreModelError] = React.useState<string | null>(null);

  // Custom params state
  const [customParams, setCustomParams] = React.useState<CustomParamPreset[]>([]);
  const [initialCustomParams, setInitialCustomParams] = React.useState<CustomParamPreset[]>([]);
  const [customParamsSaving, setCustomParamsSaving] = React.useState(false);
  const [customParamsError, setCustomParamsError] = React.useState<string | null>(null);

  // Editing state for custom params
  const [editingPreset, setEditingPreset] = React.useState<CustomParamPreset | null>(null);
  const [isEditingNew, setIsEditingNew] = React.useState(false);
  const [editLabel, setEditLabel] = React.useState('');
  const [editId, setEditId] = React.useState('');
  const [editParamsJson, setEditParamsJson] = React.useState('');
  const [editJsonError, setEditJsonError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await httpClient.get('/v1/user-settings');
        const keys = res.data || {};

        const loadedMaxIterations = keys.max_tool_iterations ?? 10;
        setMaxToolIterations(String(loadedMaxIterations));
        setInitialMaxToolIterations(String(loadedMaxIterations));
        setMaxToolIterationsError(null);

        const loadedChoreModel = keys.chore_model || '';
        setChoreModel(loadedChoreModel);
        setInitialChoreModel(loadedChoreModel);
        setChoreModelError(null);

        let loadedCustomParams = keys.custom_request_params;
        // Ensure it's an array
        if (!loadedCustomParams || !Array.isArray(loadedCustomParams)) {
          loadedCustomParams = [];
        }

        setCustomParams(loadedCustomParams);
        setInitialCustomParams(loadedCustomParams);
        setCustomParamsError(null);
      } catch (err: any) {
        setMaxToolIterationsError(err?.message || 'Failed to load max tool iterations');
        setChoreModelError(err?.message || 'Failed to load chore model');
        setCustomParamsError(err?.message || 'Failed to load custom request params');
      }
    })();
  }, [isOpen]);

  const handleSaveCustomParams = async (newParams: CustomParamPreset[]) => {
    setCustomParamsSaving(true);
    setCustomParamsError(null);
    try {
      await httpClient.put('/v1/user-settings', {
        custom_request_params: newParams,
      });
      setInitialCustomParams(newParams);
      setCustomParams(newParams);
      showToast({
        message: 'Custom request params saved successfully!',
        variant: 'success',
      });
      onSettingsChanged?.();
    } catch (err: any) {
      setCustomParamsError(err?.message || 'Failed to save custom request params');
    } finally {
      setCustomParamsSaving(false);
    }
  };

  const startEditing = (preset?: CustomParamPreset) => {
    if (preset) {
      setEditingPreset(preset);
      setIsEditingNew(false);
      setEditLabel(preset.label);
      setEditId(preset.id);
      setEditParamsJson(JSON.stringify(preset.params, null, 2));
    } else {
      setEditingPreset({ id: '', label: '', params: {} });
      setIsEditingNew(true);
      setEditLabel('');
      setEditId('');
      setEditParamsJson('{\n  \n}');
    }
    setEditJsonError(null);
  };

  const generateIdFromName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  };

  const saveEditing = () => {
    // Validate
    if (!editLabel.trim()) {
      setEditJsonError('Label is required');
      return;
    }
    let finalId = editId.trim();
    if (!finalId) {
      finalId = generateIdFromName(editLabel.trim());
      if (!finalId) {
        setEditJsonError('Could not generate ID from label. Please enter an ID manually.');
        return;
      }
      // Handle collision for auto-generated ID
      let candidateId = finalId;
      let counter = 1;
      while (customParams.some((p) => p.id === candidateId)) {
        candidateId = `${finalId}-${counter}`;
        counter++;
      }
      finalId = candidateId;
    } else {
      // Check UNIQUE ID if entered manually
      if (isEditingNew || (editingPreset && editingPreset.id !== finalId)) {
        if (customParams.some((p) => p.id === finalId)) {
          setEditJsonError('ID must be unique');
          return;
        }
      }
    }

    let parsedParams = {};
    try {
      parsedParams = JSON.parse(editParamsJson);
      if (
        typeof parsedParams !== 'object' ||
        parsedParams === null ||
        Array.isArray(parsedParams)
      ) {
        throw new Error('Must be a JSON object');
      }
    } catch (e: any) {
      setEditJsonError('Invalid JSON params: ' + e.message);
      return;
    }

    const newPreset: CustomParamPreset = {
      id: finalId,
      label: editLabel.trim(),
      params: parsedParams,
    };

    let newParamsList;

    if (isEditingNew) {
      newParamsList = [...customParams, newPreset];
    } else {
      if (editingPreset) {
        newParamsList = customParams.map((p) => (p.id === editingPreset.id ? newPreset : p));
      } else {
        newParamsList = [...customParams];
      }
    }

    handleSaveCustomParams(newParamsList);
    setEditingPreset(null);
  };

  const duplicatePreset = (preset: CustomParamPreset) => {
    setEditingPreset({ id: '', label: '', params: {} });
    setIsEditingNew(true);
    setEditLabel(`${preset.label} (Copy)`);
    setEditId('');
    setEditParamsJson(JSON.stringify(preset.params, null, 2));
    setEditJsonError(null);
  };

  const deletePreset = (id: string) => {
    if (confirm('Are you sure you want to delete this preset?')) {
      const newParamsList = customParams.filter((p) => p.id !== id);
      handleSaveCustomParams(newParamsList);
    }
  };

  const saveMaxToolIterations = async () => {
    setMaxToolIterationsSaving(true);
    setMaxToolIterationsError(null);
    try {
      const trimmed = (maxToolIterations || '').toString().trim();
      if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error('Please enter a valid integer between 1 and 50');
      }
      const parsed = parseInt(trimmed, 10);
      if (parsed < 1 || parsed > 50) {
        throw new Error('Please enter a number between 1 and 50');
      }
      await httpClient.put('/v1/user-settings', {
        max_tool_iterations: parsed,
      });
      setInitialMaxToolIterations(String(parsed));
      setMaxToolIterations(String(parsed));
      showToast({
        message: 'Maximum tool iterations saved successfully!',
        variant: 'success',
      });
    } catch (err: any) {
      setMaxToolIterationsError(err?.message || 'Failed to save maximum tool iterations');
    } finally {
      setMaxToolIterationsSaving(false);
    }
  };

  const saveChoreModel = async () => {
    setChoreModelSaving(true);
    setChoreModelError(null);
    try {
      await httpClient.put('/v1/user-settings', {
        chore_model: choreModel,
      });
      setInitialChoreModel(choreModel);
      showToast({
        message: 'Chore model saved successfully!',
        variant: 'success',
      });
      onSettingsChanged?.();
    } catch (err: any) {
      setChoreModelError(err?.message || 'Failed to save chore model');
    } finally {
      setChoreModelSaving(false);
    }
  };

  const maxToolIterationsSaved = maxToolIterations === initialMaxToolIterations;
  const choreModelSaved = choreModel === initialChoreModel;

  return (
    <div className={isVisible ? 'flex flex-col gap-6' : 'hidden'}>
      {/* Maximum tool call iterations */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          id="max-tool-iterations-heading"
          title="Maximum Tool Call Iterations"
          saved={maxToolIterationsSaved}
          description="Maximum number of consecutive tool calling turns before stopping (1-50)"
        />
        <Input
          type="text"
          aria-labelledby="max-tool-iterations-heading"
          aria-describedby="max-tool-iterations-help"
          aria-invalid={maxToolIterationsError ? true : undefined}
          value={maxToolIterations}
          onChange={(e) => {
            setMaxToolIterations(e.target.value);
            setMaxToolIterationsError(null);
          }}
        />
        {maxToolIterationsError && <ErrorText>{maxToolIterationsError}</ErrorText>}
        <p id="max-tool-iterations-help" className="text-xs text-fg-muted">
          Default is 10. This prevents infinite loops when the AI continuously requests tool calls.
          Increase for complex tasks requiring many tool iterations, decrease to save on API costs.
        </p>
        <Button
          className="self-end"
          title="Save maximum tool call iterations"
          onClick={saveMaxToolIterations}
          disabled={maxToolIterationsSaving || maxToolIterationsSaved}
        >
          {maxToolIterationsSaving ? (
            <>
              <RefreshCw className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save />
              {maxToolIterationsSaved ? 'Saved' : 'Save Setting'}
            </>
          )}
        </Button>
      </section>

      {/* Chore model */}
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <SectionHeading
          id="chore-model-heading"
          title="Chore Model"
          saved={choreModelSaved && initialChoreModel !== ''}
          description="Select a model for mundane tasks like generating conversation titles"
        />
        <ModelSelector
          value={choreModel}
          onChange={(value) => {
            setChoreModel(value);
            setChoreModelError(null);
          }}
          groups={modelGroups}
          fallbackOptions={modelOptions}
          ariaLabel="Select chore model"
        />
        {choreModelError && <ErrorText>{choreModelError}</ErrorText>}
        <p className="text-xs text-fg-muted">
          Use a smaller, faster model for tasks like generating conversation titles to save on API
          costs. Leave empty to use the main conversation model.
        </p>
        <Button
          className="self-end"
          title="Save chore model setting"
          onClick={saveChoreModel}
          disabled={choreModelSaving || choreModelSaved}
        >
          {choreModelSaving ? (
            <>
              <RefreshCw className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save />
              {choreModelSaved ? 'Saved' : 'Save Setting'}
            </>
          )}
        </Button>
      </section>

      {/* Custom request params */}
      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-fg">Custom Request Params</h4>
              {customParamsSaving && (
                <RefreshCw aria-label="Saving" className="size-4 animate-spin text-fg-muted" />
              )}
            </div>
            <p className="text-sm text-fg-muted">
              Define reusable JSON blocks to append to upstream requests
            </p>
          </div>
          {!editingPreset && (
            <Button
              size="sm"
              onClick={() => startEditing()}
              title="Add a new custom request parameter preset"
            >
              <Plus />
              Add Preset
            </Button>
          )}
        </div>

        {customParamsError && <ErrorText>{customParamsError}</ErrorText>}

        {editingPreset ? (
          <div className="flex flex-col gap-4 rounded-card border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-medium text-fg">
                {isEditingNew ? 'Create New Preset' : 'Edit Preset'}
              </h5>
              <IconButton
                label="Cancel editing"
                title="Cancel editing"
                size="sm"
                onClick={() => setEditingPreset(null)}
              >
                <X />
              </IconButton>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Label">
                <Input
                  type="text"
                  placeholder="My Preset"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
              </Field>
              <Field label="ID" hint="(Optional)">
                <Input
                  type="text"
                  placeholder="Auto-generated"
                  value={editId}
                  onChange={(e) => setEditId(e.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>

            <div className="relative">
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    <Code aria-hidden="true" className="size-4" /> API Params (JSON Object)
                  </span>
                }
                description="Provide the JSON object to be merged into the request body."
                error={editJsonError}
              >
                <Textarea
                  rows={6}
                  value={editParamsJson}
                  onChange={(e) => {
                    setEditParamsJson(e.target.value);
                    setEditJsonError(null);
                  }}
                  className="font-mono text-xs"
                />
              </Field>
              <IconButton
                label="Copy JSON to clipboard"
                title="Copy JSON to clipboard"
                size="sm"
                className="absolute top-0 right-0 size-6"
                onClick={() => {
                  navigator.clipboard.writeText(editParamsJson);
                  showToast({ message: 'JSON copied to clipboard!', variant: 'success' });
                }}
              >
                <Copy />
              </IconButton>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingPreset(null)}
                title="Cancel editing"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveEditing}
                disabled={customParamsSaving}
                title="Save this preset"
              >
                {customParamsSaving && <RefreshCw className="animate-spin" />}
                Save Preset
              </Button>
            </div>
          </div>
        ) : customParams.length === 0 ? (
          <p className="rounded-card border border-line p-8 text-center text-sm text-fg-muted">
            No presets defined.
          </p>
        ) : (
          <ul className="max-h-75 divide-y divide-line overflow-y-auto rounded-card border border-line">
            {customParams.map((preset) => (
              <li key={preset.id} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-fg">
                    {preset.label}
                    <span className="rounded-control bg-muted px-1 font-mono text-xs font-normal text-fg-muted">
                      {preset.id}
                    </span>
                  </div>
                  <div className="truncate font-mono text-xs text-fg-muted">
                    {JSON.stringify(preset.params)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label="Copy JSON to clipboard"
                    title="Copy JSON to clipboard"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(preset.params, null, 2));
                      showToast({
                        message: 'Params copied to clipboard!',
                        variant: 'success',
                      });
                    }}
                  >
                    <Copy />
                  </IconButton>
                  <IconButton
                    label="Duplicate preset"
                    title="Duplicate preset"
                    size="sm"
                    onClick={() => duplicatePreset(preset)}
                  >
                    <CopyPlus />
                  </IconButton>
                  <IconButton
                    label="Edit preset"
                    title="Edit preset"
                    size="sm"
                    onClick={() => startEditing(preset)}
                  >
                    <Edit2 />
                  </IconButton>
                  <IconButton
                    label="Delete preset"
                    title="Delete preset"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => deletePreset(preset.id)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="border-t border-line pt-6 text-xs text-fg-muted">
        <strong className="font-medium text-fg">Note:</strong> These settings affect how the AI
        handles tool execution. Changes take effect immediately for new conversations.
      </p>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  saved,
  description,
}: {
  id: string;
  title: string;
  saved: boolean;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h4 id={id} className="text-sm font-medium text-fg">
          {title}
        </h4>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check aria-hidden="true" className="size-4" />
            Saved
          </span>
        )}
      </div>
      <p className="text-sm text-fg-muted">{description}</p>
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1 text-xs text-danger">
      <XCircle aria-hidden="true" className="size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
