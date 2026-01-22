'use client';

import React from 'react';
import { Check, RefreshCw, Save, XCircle } from 'lucide-react';
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

  const [customParamsText, setCustomParamsText] = React.useState<string>('[]');
  const [initialCustomParamsText, setInitialCustomParamsText] = React.useState<string>('[]');
  const [customParamsSaving, setCustomParamsSaving] = React.useState(false);
  const [customParamsError, setCustomParamsError] = React.useState<string | null>(null);

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

        const loadedCustomParams = keys.custom_request_params ?? null;
        const nextCustomParamsText = loadedCustomParams
          ? JSON.stringify(loadedCustomParams, null, 2)
          : '[]';
        setCustomParamsText(nextCustomParamsText);
        setInitialCustomParamsText(nextCustomParamsText);
        setCustomParamsError(null);
      } catch (err: any) {
        setMaxToolIterationsError(err?.message || 'Failed to load max tool iterations');
        setChoreModelError(err?.message || 'Failed to load chore model');
        setCustomParamsError(err?.message || 'Failed to load custom request params');
      }
    })();
  }, [isOpen]);

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
        <div>
          <div className="flex items-center gap-2">
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Custom Request Params
            </label>
            {customParamsText === initialCustomParamsText && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Define reusable JSON blocks to append to upstream requests. Example:
          </p>
          <pre className="mt-2 text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/70 rounded-lg p-3 text-zinc-700 dark:text-zinc-200 overflow-x-auto">
            {`[
  {
    "id": "thinking-on",
    "label": "Thinking on",
    "params": {
      "chat_template_kwargs": {
        "enable_thinking": 1
      }
    }
  }
]`}
          </pre>
        </div>

        <div className="space-y-3">
          <textarea
            rows={8}
            className="w-full px-3 py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm font-mono focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
            value={customParamsText}
            onChange={(e) => {
              setCustomParamsText(e.target.value);
              setCustomParamsError(null);
            }}
            placeholder="[]"
          />

          {customParamsError && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{customParamsError}</span>
            </p>
          )}

          <button
            type="button"
            onClick={async () => {
              setCustomParamsSaving(true);
              setCustomParamsError(null);
              try {
                const trimmed = customParamsText.trim();
                if (!trimmed) {
                  await httpClient.put('/v1/user-settings', {
                    custom_request_params: null,
                  });
                  setCustomParamsText('[]');
                  setInitialCustomParamsText('[]');
                  showToast({
                    message: 'Custom request params cleared.',
                    variant: 'success',
                  });
                  onSettingsChanged?.();
                  return;
                }

                const parsed = JSON.parse(trimmed);
                if (!Array.isArray(parsed)) {
                  throw new Error('Custom request params must be a JSON array');
                }

                await httpClient.put('/v1/user-settings', {
                  custom_request_params: parsed,
                });
                setInitialCustomParamsText(JSON.stringify(parsed, null, 2));
                setCustomParamsText(JSON.stringify(parsed, null, 2));
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
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white dark:text-zinc-900 disabled:cursor-not-allowed transition-colors shadow-sm"
            disabled={customParamsSaving || customParamsText === initialCustomParamsText}
          >
            {customParamsSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {customParamsText === initialCustomParamsText ? 'Saved' : 'Save Presets'}
              </>
            )}
          </button>
        </div>
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
