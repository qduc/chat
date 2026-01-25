import { useState, useCallback, useRef, useEffect } from 'react';
import { httpClient } from '../lib';
import type { ModelGroup, ModelOption } from '../lib';

const SELECTED_MODEL_KEY = 'selectedModel';

/**
 * Hook for managing model and provider selection.
 *
 * Handles:
 * - Loading available models from all configured providers
 * - Persisting selected model to localStorage
 * - Building model-to-provider mapping for qualified model IDs
 * - Tracking model capabilities for feature detection
 *
 * @returns Model selection state and controls:
 * - `model` / `setModel`: Current model (persisted to localStorage)
 * - `modelRef`: Ref for accessing model in callbacks
 * - `providerId` / `setProviderId`: Current provider selection
 * - `modelGroups`: Models grouped by provider for UI
 * - `modelOptions`: Flat list of all model options
 * - `modelToProvider`: Map of model ID to provider ID
 * - `modelCapabilities`: Map of model ID to capability metadata
 * - `loadProvidersAndModels()`: Refresh models from API
 * - `forceRefreshModels()`: Force refresh bypassing cache
 */
export function useModelSelection() {
  const [model, setModelState] = useState<string>('');
  const modelRef = useRef<string>('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const providerIdRef = useRef<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelToProvider, setModelToProvider] = useState<Record<string, string>>({});
  const modelToProviderRef = useRef<Record<string, string>>({});
  const [modelCapabilities, setModelCapabilities] = useState<any>(null);

  // persisted setter - saves last manually selected model to localStorage
  const setModel = useCallback((m: string) => {
    setModelState(m);
    modelRef.current = m;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SELECTED_MODEL_KEY, m);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const setProviderIdWrapper = useCallback(
    (id: string | null | ((prev: string | null) => string | null)) => {
      setProviderId((prev) => {
        const nextValue = typeof id === 'function' ? id(prev) : id;
        providerIdRef.current = nextValue;
        return nextValue;
      });
    },
    []
  );

  const loadProvidersAndModels = useCallback(async (options?: { forceRefresh?: boolean }) => {
    try {
      setIsLoadingModels(true);

      // Use batch endpoint to fetch all models in one call
      const endpoint = options?.forceRefresh ? '/v1/models?refresh=true' : '/v1/models';
      const response = await httpClient.get<{
        providers: Array<{
          provider: { id: string; name: string; provider_type: string };
          models: any[];
        }>;
        cached: boolean;
        cachedAt: string;
        errors?: Array<{ providerId: string; providerName: string; error: string }>;
      }>(endpoint);

      const providerModels = response.data.providers || [];

      if (providerModels.length === 0) {
        setModelGroups([]);
        setModelOptions([]);
        setModelToProvider({});
        modelToProviderRef.current = {};
        return;
      }

      const groups: ModelGroup[] = [];
      const allOptions: ModelOption[] = [];
      const modelToProviderMap: Record<string, string> = {};
      const capabilitiesMap: Record<string, any> = {};

      for (const { provider, models } of providerModels) {
        if (models.length > 0) {
          // Create model options for this provider with provider-qualified values
          const providerOptions: ModelOption[] = models.map((model: any) => ({
            value: `${provider.id}::${model.id}`,
            label: model.id,
          }));

          groups.push({
            id: provider.id,
            label: provider.name,
            options: providerOptions,
          });

          allOptions.push(...providerOptions);

          // Build model to provider mapping and store model capabilities
          models.forEach((model: any) => {
            const qualifiedId = `${provider.id}::${model.id}`;
            modelToProviderMap[qualifiedId] = provider.id;
            capabilitiesMap[qualifiedId] = model;

            if (!modelToProviderMap[model.id]) {
              modelToProviderMap[model.id] = provider.id;
            }

            if (Array.isArray(model.aliases)) {
              for (const alias of model.aliases) {
                if (typeof alias === 'string' && !modelToProviderMap[alias]) {
                  modelToProviderMap[alias] = provider.id;
                }
              }
            }
          });
        }
      }

      setModelGroups(groups);
      setModelOptions(allOptions);
      setModelToProvider(modelToProviderMap);
      setModelCapabilities(capabilitiesMap);
      modelToProviderRef.current = modelToProviderMap;

      // Set default provider if not already set
      if (providerModels.length > 0) {
        setProviderId((prev) => {
          const nextValue = prev ?? providerModels[0].provider.id;
          providerIdRef.current = nextValue;
          return nextValue;
        });
      }

      // Log any errors from providers that failed to fetch
      if (response.data.errors && response.data.errors.length > 0) {
        console.warn('Some providers failed to fetch models:', response.data.errors);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const forceRefreshModels = useCallback(() => {
    return loadProvidersAndModels({ forceRefresh: true });
  }, [loadProvidersAndModels]);

  // Load providers and models on mount
  useEffect(() => {
    loadProvidersAndModels();
  }, [loadProvidersAndModels]);

  // On mount, if no model is set, try to load from localStorage
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !modelRef.current) {
        const saved = window.localStorage.getItem(SELECTED_MODEL_KEY);
        if (saved) {
          setModelState(saved);
          modelRef.current = saved;
        }
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    model,
    modelRef,
    providerId,
    providerIdRef,
    isLoadingModels,
    modelGroups,
    modelOptions,
    modelToProvider,
    modelToProviderRef,
    modelCapabilities,
    setModel,
    setModelState,
    setProviderId: setProviderIdWrapper,
    loadProvidersAndModels,
    forceRefreshModels,
  };
}
