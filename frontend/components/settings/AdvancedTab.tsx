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
  AlertCircle,
  Copy,
  CopyPlus,
} from 'lucide-react';
import ModelSelector from '../ui/ModelSelector';
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

  return (
    <div className={isVisible ? 'space-y-4' : 'hidden'}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Advanced Settings
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Configure advanced behavior and limits
          </p>
        </div>
      </div>

      {/* Max Tool Iterations Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 p-5 shadow-sm space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Maximum Tool Call Iterations
            </label>
            {maxToolIterations === initialMaxToolIterations && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Maximum number of consecutive tool calling turns before stopping (1-50)
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            className="w-full px-3 py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
            value={maxToolIterations}
            onChange={(e) => {
              setMaxToolIterations(e.target.value);
              setMaxToolIterationsError(null);
            }}
          />

          {maxToolIterationsError && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{maxToolIterationsError}</span>
            </p>
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Default is 10. This prevents infinite loops when the AI continuously requests tool
            calls. Increase for complex tasks requiring many tool iterations, decrease to save on
            API costs.
          </p>

          <button
            type="button"
            title="Save maximum tool call iterations"
            onClick={async () => {
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
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white dark:text-zinc-900 disabled:cursor-not-allowed transition-colors shadow-sm"
            disabled={maxToolIterationsSaving || maxToolIterations === initialMaxToolIterations}
          >
            {maxToolIterationsSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {maxToolIterations === initialMaxToolIterations ? 'Saved' : 'Save Setting'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Chore Model Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 p-5 shadow-sm space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Chore Model
            </label>
            {choreModel === initialChoreModel && initialChoreModel !== '' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Select a model for mundane tasks like generating conversation titles
          </p>
        </div>

        <div className="space-y-3">
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

          {choreModelError && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{choreModelError}</span>
            </p>
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Use a smaller, faster model for tasks like generating conversation titles to on API
            costs. Leave empty to use the main conversation model.
          </p>

          <button
            type="button"
            title="Save chore model setting"
            onClick={async () => {
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
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white dark:text-zinc-900 disabled:cursor-not-allowed transition-colors shadow-sm"
            disabled={choreModelSaving || choreModel === initialChoreModel}
          >
            {choreModelSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {choreModel === initialChoreModel ? 'Saved' : 'Save Setting'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Custom Request Params Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Custom Request Params
              </label>
              {customParamsSaving && <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Define reusable JSON blocks to append to upstream requests
            </p>
          </div>
          {!editingPreset && (
            <button
              onClick={() => startEditing()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-md transition-colors"
              type="button"
              title="Add a new custom request parameter preset"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Preset
            </button>
          )}
        </div>

        {customParamsError && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
            <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{customParamsError}</span>
          </p>
        )}

        {editingPreset ? (
          <div className="bg-zinc-50/50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200/70 dark:border-zinc-700/70 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {isEditingNew ? 'Create New Preset' : 'Edit Preset'}
              </h4>
              <button
                onClick={() => setEditingPreset(null)}
                className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                type="button"
                title="Cancel editing"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Label
                </label>
                <input
                  type="text"
                  placeholder="My Preset"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Auto-generated"
                  value={editId}
                  onChange={(e) => setEditId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center justify-between gap-1 w-full">
                <span className="flex items-center gap-1">
                  <Code className="w-3 h-3" /> API Params (JSON Object)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(editParamsJson);
                    showToast({ message: 'JSON copied to clipboard!', variant: 'success' });
                  }}
                  className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  title="Copy JSON to clipboard"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </label>
              <textarea
                rows={6}
                value={editParamsJson}
                onChange={(e) => {
                  setEditParamsJson(e.target.value);
                  setEditJsonError(null);
                }}
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
              {editJsonError ? (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {editJsonError}
                </p>
              ) : (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  Provide the JSON object to be merged into the request body.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingPreset(null)}
                className="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors"
                type="button"
                title="Cancel editing"
              >
                Cancel
              </button>
              <button
                onClick={saveEditing}
                disabled={customParamsSaving}
                className="px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-md hover:opacity-90 transition-opacity flex items-center gap-1.5"
                type="button"
                title="Save this preset"
              >
                {customParamsSaving && <RefreshCw className="w-3 h-3 animate-spin" />}
                Save Preset
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-50/50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50 divide-y divide-zinc-200/50 dark:divide-zinc-700/50 max-h-[300px] overflow-y-auto">
            {customParams.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No presets defined.
              </div>
            ) : (
              customParams.map((preset) => (
                <div
                  key={preset.id}
                  className="p-3 flex items-start justify-between hover:bg-white dark:hover:bg-zinc-800/80 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      {preset.label}
                      <span className="text-[10px] px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-300 font-mono">
                        {preset.id}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono truncate max-w-[400px]">
                      {JSON.stringify(preset.params)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(preset.params, null, 2));
                        showToast({
                          message: 'Params copied to clipboard!',
                          variant: 'success',
                        });
                      }}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                      title="Copy JSON to clipboard"
                      type="button"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => duplicatePreset(preset)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                      title="Duplicate preset"
                      type="button"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => startEditing(preset)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                      title="Edit preset"
                      type="button"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Delete preset"
                      type="button"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-4 border border-slate-200/30 dark:border-neutral-700/30">
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <strong className="font-semibold text-slate-700 dark:text-slate-300">Note:</strong> These
          settings affect how the AI handles tool execution. Changes take effect immediately for new
          conversations.
        </p>
      </div>
    </div>
  );
}
