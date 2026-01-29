import { useState, useCallback, useRef } from 'react';
import { httpClient } from '../lib/http';
import type { ReasoningEffortLevel, CustomRequestParamPreset } from '../lib/types';

/**
 * Hook for managing chat settings (tools, streaming, reasoning, prompts).
 *
 * Handles:
 * - Tool usage toggles and enabled tools list
 * - Streaming preferences
 * - Reasoning effort level controls
 * - System prompt management
 * - Custom request parameters from user settings
 *
 * Each setting has both state and a ref for callback access.
 *
 * @returns Settings state and controls:
 * - `useTools` / `setUseTools`: Master tool toggle
 * - `enabledTools` / `setEnabledTools`: List of enabled tool names
 * - `shouldStream` / `setShouldStream`: Streaming preference
 * - `reasoningEffort` / `setReasoningEffort`: Reasoning effort level
 * - `systemPrompt` / `activeSystemPromptId`: System prompt state
 * - `customRequestParams` / `customRequestParamsId`: Custom API params
 * - `refreshUserSettings(userId)`: Reload settings from API
 */
export function useChatSettings() {
  const [useTools, setUseTools] = useState(true);
  const useToolsRef = useRef<boolean>(true);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const enabledToolsRef = useRef<string[]>([]);
  const [shouldStream, setShouldStream] = useState(true);
  const shouldStreamRef = useRef<boolean>(true);
  const providerStreamRef = useRef<boolean>(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortLevel>('unset');
  const reasoningEffortRef = useRef<ReasoningEffortLevel>('unset');
  const [customRequestParams, setCustomRequestParams] = useState<CustomRequestParamPreset[]>([]);
  const [customRequestParamsId, setCustomRequestParamsId] = useState<string[]>([]);
  const customRequestParamsIdRef = useRef<string[]>([]);

  const [activeSystemPromptId, setActiveSystemPromptId] = useState<string | null | undefined>(
    undefined
  );
  const activeSystemPromptIdRef = useRef<string | null | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemPromptRef = useRef<string | null>(null);

  const setUseToolsWrapper = useCallback((value: boolean) => {
    setUseTools(value);
    useToolsRef.current = value;
  }, []);

  const setEnabledToolsWrapper = useCallback((tools: string[]) => {
    setEnabledTools(tools);
    enabledToolsRef.current = tools;
  }, []);

  const setShouldStreamWrapper = useCallback((value: boolean) => {
    setShouldStream(value);
    shouldStreamRef.current = value;
    providerStreamRef.current = value;
  }, []);

  const setReasoningEffortWrapper = useCallback((level: ReasoningEffortLevel) => {
    setReasoningEffort(level);
    reasoningEffortRef.current = level;
  }, []);

  const setCustomRequestParamsIdWrapper = useCallback((value: string[] | null) => {
    const normalized = Array.isArray(value) ? value : [];
    setCustomRequestParamsId(normalized);
    customRequestParamsIdRef.current = normalized;
  }, []);

  const setActiveSystemPromptIdWrapper = useCallback((id: string | null | undefined) => {
    setActiveSystemPromptId(id);
    activeSystemPromptIdRef.current = id;
  }, []);

  const normalizeCustomRequestParams = useCallback((value: any): CustomRequestParamPreset[] => {
    if (!value) return [];
    const parsed =
      typeof value === 'string'
        ? (() => {
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          })()
        : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any, index: number) => {
        if (!item || typeof item !== 'object') return null;
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        const id =
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : label || `preset-${index + 1}`;
        const params =
          item.params && typeof item.params === 'object' && !Array.isArray(item.params)
            ? item.params
            : {};
        return { id, label: label || id, params };
      })
      .filter(Boolean) as CustomRequestParamPreset[];
  }, []);

  const refreshUserSettings = useCallback(
    async (userId?: string) => {
      if (!userId) return;
      try {
        const res = await httpClient.get('/v1/user-settings');
        const settings = res.data || {};
        const presets = normalizeCustomRequestParams(settings.custom_request_params);
        setCustomRequestParams(presets);
      } catch (err) {
        console.warn('[useChatSettings] Failed to load user settings:', err);
        setCustomRequestParams([]);
      }
    },
    [normalizeCustomRequestParams]
  );

  return {
    useTools,
    useToolsRef,
    setUseTools: setUseToolsWrapper,
    enabledTools,
    enabledToolsRef,
    setEnabledTools: setEnabledToolsWrapper,
    shouldStream,
    shouldStreamRef,
    providerStreamRef,
    setShouldStream: setShouldStreamWrapper,
    reasoningEffort,
    reasoningEffortRef,
    setReasoningEffort: setReasoningEffortWrapper,
    customRequestParams,
    customRequestParamsId,
    customRequestParamsIdRef,
    setCustomRequestParamsId: setCustomRequestParamsIdWrapper,
    activeSystemPromptId,
    activeSystemPromptIdRef,
    setActiveSystemPromptId: setActiveSystemPromptIdWrapper,
    systemPrompt,
    systemPromptRef,
    setSystemPrompt,
    refreshUserSettings,
  };
}
