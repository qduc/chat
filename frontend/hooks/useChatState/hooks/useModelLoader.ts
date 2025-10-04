/**
 * Model loader hook
 *
 * Manages loading and synchronization of provider and model data from the backend.
 * Handles provider filtering, model capability detection, and model selection state.
 *
 * @module useModelLoader
 */

import { useCallback, useEffect } from 'react';
import type { ChatAction } from '../types';
import type { Group as TabGroup, Option as ModelOption } from '../../../components/ui/TabbedSelect';
import { httpClient } from '../../../lib/http/client';

/**
 * Props for the useModelLoader hook
 */
export interface UseModelLoaderProps {
  /** Whether authentication is ready */
  authReady: boolean;
  /** Current authenticated user */
  user: any;
  /** Ref to current model for synchronous access */
  modelRef: React.RefObject<string>;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook for loading providers and models
 *
 * Handles fetching provider list, model list per provider,
 * and managing model selection state.
 *
 * @param props - Configuration object
 * @returns Object containing conversation manager and refresh function
 *
 * @example
 * ```typescript
 * const { loadProvidersAndModels } = useModelLoader({
 *   authReady,
 *   user,
 *   modelRef,
 *   dispatch
 * });
 *
 * await loadProvidersAndModels();
 * ```
 */
export function useModelLoader({ authReady, user, modelRef, dispatch }: UseModelLoaderProps) {
  const loadProvidersAndModels = useCallback(async () => {
    if (!authReady || !user) {
      return;
    }
    try {
      dispatch({ type: 'SET_LOADING_MODELS', payload: true });
      const response = await httpClient.get<{ providers: any[] }>('/v1/providers');
      const providers: any[] = Array.isArray(response.data.providers) ? response.data.providers : [];
      const enabledProviders = providers.filter(p => p?.enabled);
      if (!enabledProviders.length) {
        dispatch({ type: 'SET_LOADING_MODELS', payload: false });
        return;
      }

      const results = await Promise.allSettled(
        enabledProviders.map(async (p) => {
          const modelsResponse = await httpClient.get<{ models: any[] }>(`/v1/providers/${encodeURIComponent(p.id)}/models`);
          const models = Array.isArray(modelsResponse.data.models) ? modelsResponse.data.models : [];
          const options: ModelOption[] = models.map((m: any) => ({ value: m.id, label: m.id }));
          return { provider: p, options, models };
        })
      );

      const gs: TabGroup[] = [];
      const modelProviderMap: Record<string, string> = {};
      const modelCapabilitiesMap: Record<string, any> = {};

      for (let i = 0; i < results.length; i++) {
        const r: any = results[i];
        if (r.status === 'fulfilled' && r.value.options.length > 0) {
          const providerId = r.value.provider.id;
          gs.push({ id: providerId, label: r.value.provider.name || providerId, options: r.value.options });
          r.value.options.forEach((option: any) => {
            modelProviderMap[option.value] = providerId;
          });
          // Store model capabilities (e.g., supported_parameters from OpenRouter)
          r.value.models.forEach((m: any) => {
            if (m && m.id) {
              modelCapabilitiesMap[m.id] = m;
            }
          });
        }
      }

      const flat = gs.flatMap(g => g.options);
      if (gs.length === 0) {
        dispatch({ type: 'SET_LOADING_MODELS', payload: false });
        return;
      }

      dispatch({ type: 'SET_MODEL_LIST', payload: { groups: gs, options: flat, modelToProvider: modelProviderMap, modelCapabilities: modelCapabilitiesMap } });

      // Ensure current model exists in the new list, otherwise pick first
      const currentModel = modelRef.current;
      if (flat.length > 0 && !flat.some((o: any) => o.value === currentModel)) {
        const fallbackModel = flat[0].value;
        if (modelRef.current) {
          (modelRef as any).current = fallbackModel;
        }
        dispatch({ type: 'SET_MODEL', payload: fallbackModel });
      }
    } catch {
      // ignore
    } finally {
      dispatch({ type: 'SET_LOADING_MODELS', payload: false });
    }
  }, [authReady, user, modelRef, dispatch]);

  // Load models on mount
  useEffect(() => {
    if (!authReady) {
      return;
    }
    void loadProvidersAndModels();
  }, [authReady, loadProvidersAndModels]);

  // Listen for external provider change events to refresh models
  useEffect(() => {
    const handler = () => { void loadProvidersAndModels(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('chat:providers_changed', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('chat:providers_changed', handler as EventListener);
      }
    };
  }, [loadProvidersAndModels]);

  return { loadProvidersAndModels };
}
