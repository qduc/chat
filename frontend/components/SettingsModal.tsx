'use client';
import React from 'react';
import {
  Cog,
  Database,
  Plus,
  Save,
  RefreshCw,
  Trash2,
  Zap,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  Sliders,
} from 'lucide-react';
import Modal from './ui/Modal';
import Toggle from './ui/Toggle';
import { httpClient } from '../lib';
import { HttpError } from '../lib';
import { resolveApiBase } from '../lib';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onProvidersChanged?: () => void;
}

export default function SettingsModal({ open, onClose, onProvidersChanged }: SettingsModalProps) {
  // --- Providers management state ---
  type ProviderRow = {
    id: string;
    name: string;
    provider_type: string;
    base_url?: string | null;
    api_key?: string | null;
    enabled?: number | boolean;
    extra_headers?: Record<string, any>;
    metadata?: Record<string, any>;
    created_at?: string;
    updated_at?: string;
  };

  const apiBase = React.useMemo(() => resolveApiBase(), []);
  const [providers, setProviders] = React.useState<ProviderRow[]>([]);
  const [loadingProviders, setLoadingProviders] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{
    id?: string;
    name: string;
    provider_type: string;
    base_url: string;
    enabled: boolean;
    api_key?: string;
    model_filter?: string;
  }>({ name: '', provider_type: 'openai', base_url: '', enabled: true });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('providers');
  // Per-engine search API key state
  type SearchEngine = 'tavily' | 'exa' | 'searxng';
  const [searchApiKeys, setSearchApiKeys] = React.useState<Record<SearchEngine, string>>({
    tavily: '',
    exa: '',
    searxng: '',
  });
  const [searchSaving, setSearchSaving] = React.useState<Record<SearchEngine, boolean>>({
    tavily: false,
    exa: false,
    searxng: false,
  });
  const [searchErrors, setSearchErrors] = React.useState<Record<SearchEngine, string | null>>({
    tavily: null,
    exa: null,
    searxng: null,
  });
  const [searxBaseUrl, setSearxBaseUrl] = React.useState('');
  const [searxBaseUrlSaving, setSearxBaseUrlSaving] = React.useState(false);
  const [searxBaseUrlError, setSearxBaseUrlError] = React.useState<string | null>(null);
  // Max tool iterations state
  const [maxToolIterations, setMaxToolIterations] = React.useState<number>(10);
  const [maxToolIterationsSaving, setMaxToolIterationsSaving] = React.useState(false);
  const [maxToolIterationsError, setMaxToolIterationsError] = React.useState<string | null>(null);
  const [initialMaxToolIterations, setInitialMaxToolIterations] = React.useState<number>(10);
  // Per-engine reveal/hide state for API keys
  const [searchReveal, setSearchReveal] = React.useState<Record<SearchEngine, boolean>>({
    tavily: false,
    exa: false,
    searxng: false,
  });
  // Track initial values to detect changes
  const [initialSearchApiKeys, setInitialSearchApiKeys] = React.useState<
    Record<SearchEngine, string>
  >({
    tavily: '',
    exa: '',
    searxng: '',
  });
  const [initialSearxBaseUrl, setInitialSearxBaseUrl] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    null
  );
  const [toggleLoading, setToggleLoading] = React.useState<Set<string>>(new Set());
  const [showApiKey, setShowApiKey] = React.useState(false);

  // Generate user-friendly ID from provider name
  const generateIdFromName = React.useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .slice(0, 50); // Limit length
  }, []);

  const resetForm = React.useCallback(() => {
    setSelectedId(null);
    setForm({
      name: '',
      provider_type: 'openai',
      base_url: '',
      enabled: true,
      api_key: '',
      model_filter: '',
    });
    setTestResult(null);
  }, []);

  const populateFormFromRow = React.useCallback((r: ProviderRow) => {
    setForm({
      id: r.id,
      name: r.name,
      provider_type: r.provider_type,
      base_url: r.base_url || '',
      enabled: Boolean(r.enabled),
      api_key: r.api_key || '',
      model_filter: (r.metadata as any)?.model_filter || '',
    });
    setTestResult(null);
  }, []);

  const fetchProviders = React.useCallback(async () => {
    try {
      setLoadingProviders(true);
      setError(null);
      setSuccess(null);
      const response = await httpClient.get<{ providers: ProviderRow[] }>(
        `${apiBase}/v1/providers`
      );
      const rows: ProviderRow[] = Array.isArray(response.data.providers)
        ? response.data.providers
        : [];
      setProviders(rows);
      if (rows.length && selectedId) {
        const cur = rows.find((r) => r.id === selectedId);
        if (cur) populateFormFromRow(cur);
      }
    } catch (e: any) {
      const message = e instanceof HttpError ? e.message : e?.message || 'Failed to load providers';
      setError(message);
    } finally {
      setLoadingProviders(false);
    }
  }, [apiBase, selectedId, populateFormFromRow]);

  React.useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(null);
      fetchProviders();
    }
    if (open) {
      // Fetch all user settings (all keys) at once
      (async () => {
        try {
          const res = await httpClient.get('/v1/user-settings');
          const keys = res.data || {};
          const loadedKeys = {
            tavily: keys.tavily_api_key || '',
            exa: keys.exa_api_key || '',
            searxng: keys.searxng_api_key || '',
          };
          setSearchApiKeys(loadedKeys);
          setInitialSearchApiKeys(loadedKeys);
          setSearchErrors({ tavily: null, exa: null, searxng: null });
          const loadedBaseUrl = keys.searxng_base_url || '';
          setSearxBaseUrl(loadedBaseUrl);
          setInitialSearxBaseUrl(loadedBaseUrl);
          setSearxBaseUrlError(null);
          const loadedMaxIterations = keys.max_tool_iterations ?? 10;
          setMaxToolIterations(loadedMaxIterations);
          setInitialMaxToolIterations(loadedMaxIterations);
          setMaxToolIterationsError(null);
        } catch (err: any) {
          setSearchErrors({
            tavily: err?.message || 'Failed to load Tavily API key',
            exa: err?.message || 'Failed to load Exa API key',
            searxng: err?.message || 'Failed to load SearXNG API key',
          });
          setSearxBaseUrlError(err?.message || 'Failed to load SearXNG base URL');
          setMaxToolIterationsError(err?.message || 'Failed to load max tool iterations');
        }
      })();
    }
  }, [open, fetchProviders]);

  // Clear test results when form changes (but not immediately after setting them)
  const [lastTestTime, setLastTestTime] = React.useState(0);

  React.useEffect(() => {
    // Don't clear results if we just set them (within last 500ms)
    if (testResult && Date.now() - lastTestTime > 500) {
      setTestResult(null);
    }
  }, [
    form.name,
    form.provider_type,
    form.base_url,
    form.api_key,
    form.model_filter,
    testResult,
    lastTestTime,
  ]);

  // Auto-clear success messages after 3 seconds
  React.useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const onSelectProvider = (r: ProviderRow) => {
    setSelectedId(r.id);
    populateFormFromRow(r);
  };

  async function onSaveProvider() {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const payload: any = {
        name: form.name,
        provider_type: form.provider_type,
        base_url: form.base_url || null,
        enabled: form.enabled,
        metadata: { model_filter: form.model_filter || null },
      };
      if (form.api_key) payload.api_key = form.api_key;

      if (form.id) {
        // Update existing provider
        await httpClient.put(`${apiBase}/v1/providers/${form.id}`, payload);
      } else {
        // Create new provider with retry logic for ID conflicts
        const generatedId = generateIdFromName(form.name);
        let attempt = 0;
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
          const idToTry = attempt === 0 ? generatedId : `${generatedId}-${attempt}`;

          try {
            await httpClient.post(`${apiBase}/v1/providers`, { ...payload, id: idToTry });
            break; // Success, exit retry loop
          } catch (error) {
            if (error instanceof HttpError && error.status === 409 && attempt < maxAttempts - 1) {
              // Conflict error, try with next suffix
              attempt++;
              continue;
            } else {
              // Other error or max attempts reached
              throw error;
            }
          }
        }
      }
      await fetchProviders();
      if (onProvidersChanged) onProvidersChanged();
      setSuccess(form.id ? 'Provider updated successfully!' : 'Provider created successfully!');
    } catch (e: any) {
      const message = e instanceof HttpError ? e.message : e?.message || 'Failed to save provider';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  // Default provider concept removed; frontend chooses provider per request

  async function onDeleteProvider(id?: string) {
    const target = id || form.id;
    if (!target) return;
    setShowDeleteConfirm(false);
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await httpClient.delete(`${apiBase}/v1/providers/${target}`);
      resetForm();
      await fetchProviders();
      if (onProvidersChanged) onProvidersChanged();
      setSuccess('Provider deleted successfully!');
    } catch (e: any) {
      const message =
        e instanceof HttpError ? e.message : e?.message || 'Failed to delete provider';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const confirmDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleQuickToggle = React.useCallback(
    async (providerId: string, enabled: boolean) => {
      // Add to loading set
      setToggleLoading((prev) => new Set([...prev, providerId]));

      // Optimistic update
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, enabled: enabled ? 1 : 0 } : p))
      );

      try {
        setError(null);
        setSuccess(null);
        await httpClient.put(`${apiBase}/v1/providers/${providerId}`, { enabled });

        setSuccess(`Provider ${enabled ? 'enabled' : 'disabled'} successfully!`);
        if (onProvidersChanged) onProvidersChanged();
      } catch (error: any) {
        // Revert on failure
        setProviders((prev) =>
          prev.map((p) => (p.id === providerId ? { ...p, enabled: enabled ? 0 : 1 } : p))
        );
        const provider = providers.find((p) => p.id === providerId);
        const message =
          error instanceof HttpError ? error.message : error?.message || 'Unknown error';
        setError(
          `Failed to ${enabled ? 'enable' : 'disable'} ${provider?.name || 'provider'}: ${message}`
        );
      } finally {
        // Remove from loading set
        setToggleLoading((prev) => {
          const newSet = new Set(prev);
          newSet.delete(providerId);
          return newSet;
        });
      }
    },
    [apiBase, providers, onProvidersChanged]
  );

  async function testProviderConnection() {
    if (!form.name || !form.provider_type) {
      const errorResult = { success: false, message: 'Please fill in required fields first' };
      setLastTestTime(Date.now());
      setTestResult(errorResult);
      return;
    }

    // Check if we have an API key or if we're testing an existing provider
    const hasApiKey = form.api_key && form.api_key.trim() !== '';
    const isExistingProvider = form.id && form.id.trim() !== '';

    if (!hasApiKey && !isExistingProvider) {
      const errorResult = {
        success: false,
        message: 'Please enter an API key to test the connection',
      };
      setLastTestTime(Date.now());
      setTestResult(errorResult);
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      let testPayload;
      let endpoint;

      if (hasApiKey) {
        // Test with the provided API key (new provider or updating existing)
        testPayload = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url || null,
          api_key: form.api_key,
          metadata: { model_filter: form.model_filter || null },
        };
        endpoint = `${apiBase}/v1/providers/test`;
      } else {
        // Test existing provider using stored credentials
        endpoint = `${apiBase}/v1/providers/${form.id}/test`;
        testPayload = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url || null,
          metadata: { model_filter: form.model_filter || null },
        };
      }

      const response = await httpClient.post(endpoint, testPayload);
      const result = response.data;

      const successResult = {
        success: true,
        message: result?.message || 'Connection successful! Provider is working correctly.',
      };
      setLastTestTime(Date.now());
      setTestResult(successResult);
    } catch (e: any) {
      const message =
        e instanceof HttpError
          ? e.message
          : e?.message || 'Connection test failed. Please check your configuration.';
      const errorResult = {
        success: false,
        message,
      };
      setLastTestTime(Date.now());
      setTestResult(errorResult);
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        maxWidthClassName="max-w-4xl"
        title={
          (
            <div className="flex items-center gap-2">
              <Cog className="w-4 h-4" /> Settings
            </div>
          ) as any
        }
      >
        <div className="flex flex-col gap-3">
          {/* Tab Navigation */}
          <div>
            <nav
              className="flex items-center gap-2 bg-slate-50 dark:bg-neutral-900/40 rounded-lg p-1"
              aria-label="Settings tabs"
            >
              <button
                onClick={() => setActiveTab('providers')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'providers'
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-neutral-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Providers
                </div>
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'search'
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-neutral-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Search Engines
                </div>
              </button>
              <button
                onClick={() => setActiveTab('advanced')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'advanced'
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-neutral-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  Advanced
                </div>
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'providers' && (
            <div className="space-y-3">
              {/* Header with refresh button */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    AI Providers
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Manage your AI provider configurations
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-2 py-1 text-sm rounded-md border border-slate-200/70 dark:border-neutral-800 bg-transparent hover:bg-slate-50 dark:hover:bg-neutral-800 text-slate-700 dark:text-slate-300 transition-colors"
                  onClick={fetchProviders}
                  disabled={loadingProviders}
                  title="Refresh providers list"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingProviders ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 border border-red-200/70 dark:border-red-800/70">
                  <div className="text-sm text-red-700 dark:text-red-400">{error}</div>
                </div>
              )}

              {/* Success Alert */}
              {success && (
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 border border-green-200/70 dark:border-green-800/70">
                  <div className="text-sm text-green-700 dark:text-green-400">{success}</div>
                </div>
              )}

              {/* Main Content - Responsive Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 lg:max-h-[600px]">
                {/* Provider List Section */}
                <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto lg:pr-2">
                  <div className="bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-3 border border-slate-200/30 dark:border-neutral-700/30">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Your Providers
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Manage and toggle existing configurations
                        </p>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 divide-y divide-slate-200/60 dark:divide-neutral-700 shadow-sm">
                      {loadingProviders && (
                        <div className="p-3 text-sm text-slate-500 text-center">
                          Loading providers...
                        </div>
                      )}
                      {!loadingProviders && providers.length === 0 && (
                        <div className="p-6 text-center">
                          <Database className="mx-auto h-10 w-10 text-slate-400 mb-3" />
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                            No AI providers yet
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">
                            Click &quot;Add New&quot; to configure your first AI provider
                          </p>
                        </div>
                      )}
                      {providers.map((p) => (
                        <div
                          key={p.id}
                          className={`w-full p-2.5 lg:p-3 transition-colors ${
                            selectedId === p.id
                              ? 'bg-slate-50 dark:bg-neutral-800/60'
                              : 'hover:bg-slate-50 dark:hover:bg-neutral-900/40'
                          }`}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectProvider(p)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                onSelectProvider(p);
                              } else if (e.key === 't' || e.key === 'T') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleQuickToggle(p.id, !p.enabled);
                              }
                            }}
                            className="w-full text-left focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-neutral-700 focus:ring-offset-2 rounded-md"
                          >
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate capitalize">
                                  {p.name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {p.provider_type}
                                </p>
                              </div>
                              <div className="ml-3 flex items-center gap-2">
                                {toggleLoading.has(p.id) ? (
                                  <div className="flex items-center justify-center w-9 h-5">
                                    <RefreshCw className="w-4 h-4 animate-spin text-slate-500 dark:text-slate-400" />
                                  </div>
                                ) : (
                                  <Toggle
                                    checked={Boolean(p.enabled)}
                                    onChange={(enabled) => handleQuickToggle(p.id, enabled)}
                                    disabled={saving}
                                    ariaLabel={`${p.enabled ? 'Disable' : 'Enable'} ${p.name} provider`}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Provider Configuration Section */}
                <div className="lg:col-span-2 bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-3 lg:p-4 border border-slate-200/30 dark:border-neutral-700/30 lg:overflow-y-auto lg:pr-2">
                  {form.id && (
                    <>
                      {/* Add New button moved above the form */}
                      <div className="flex justify-end mb-3 lg:mb-4">
                        <button
                          type="button"
                          onClick={resetForm}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-slate-600 hover:bg-slate-700 text-white transition-colors font-medium"
                        >
                          <Plus className="w-4 h-4" />
                          Add New
                        </button>
                      </div>
                    </>
                  )}

                  <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-3 lg:p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 lg:mb-5 gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {form.id ? 'Edit Provider Configuration' : 'Add New Provider'}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {form.id
                            ? 'Update settings for this provider'
                            : 'Configure a new AI provider for your account'}
                        </p>
                      </div>
                      {form.id && (
                        <button
                          type="button"
                          onClick={confirmDelete}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-red-600 hover:bg-red-700 text-white transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 lg:space-y-4">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="provider-name"
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          Provider Name *
                        </label>
                        <input
                          id="provider-name"
                          type="text"
                          className="w-full px-3 py-2 lg:py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="e.g., OpenAI, Anthropic, Custom Provider"
                          required
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Choose a descriptive name to identify this provider
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label
                          htmlFor="provider-type"
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          Provider Type *
                        </label>
                        <select
                          id="provider-type"
                          className="w-full px-3 py-2 lg:py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                          value={form.provider_type}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, provider_type: e.target.value }))
                          }
                          required
                        >
                          <option value="openai">OpenAI Compatible</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="gemini">Google Gemini</option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {form.provider_type === 'anthropic'
                            ? 'Native Anthropic Claude API support with Messages API'
                            : form.provider_type === 'gemini'
                              ? 'Native Google Gemini API support'
                              : 'Compatible with OpenAI API format (ChatGPT, Claude, most providers)'}
                        </p>
                      </div>

                      {form.provider_type === 'openai' && (
                        <div className="space-y-1.5">
                          <label
                            htmlFor="base-url"
                            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                          >
                            Base URL
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">
                              (Optional)
                            </span>
                          </label>
                          <input
                            id="base-url"
                            type="url"
                            className="w-full px-3 py-2 lg:py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                            value={form.base_url}
                            onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                            placeholder="https://api.openai.com/v1 (auto-filled if empty)"
                          />
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Custom API endpoint. Leave empty for OpenAI&apos;s default endpoint.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1.5 relative">
                        <label
                          htmlFor="api-key"
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          API Key {!form.id && <span className="text-red-500">*</span>}
                        </label>
                        <input
                          id="api-key"
                          type={showApiKey ? 'text' : 'password'}
                          className="w-full px-3 py-2 lg:py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors pr-10"
                          value={form.api_key || ''}
                          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                          placeholder={
                            form.id
                              ? '••••••••••••••••••••'
                              : form.provider_type === 'anthropic'
                                ? 'sk-ant-api03-...'
                                : form.provider_type === 'gemini'
                                  ? 'AIzaSy...'
                                  : "sk-proj-abc123... or your provider's API key"
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                          aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                        >
                          {showApiKey ? (
                            <EyeOff className="w-5 h-5" />
                          ) : (
                            <Eye className="w-5 h-5" />
                          )}
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {form.id
                            ? 'Leave blank to keep existing key. Keys are stored securely and encrypted.'
                            : 'Your API key will be encrypted and stored securely. Never shared or logged.'}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label
                          htmlFor="model-filter"
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                        >
                          Model Filter
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">
                            (Optional)
                          </span>
                        </label>
                        <input
                          id="model-filter"
                          type="text"
                          className="w-full px-3 py-2 lg:py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                          value={form.model_filter || ''}
                          onChange={(e) => setForm((f) => ({ ...f, model_filter: e.target.value }))}
                          placeholder="gpt-4*; *sonnet*; gemini/*"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Filter models in selector using wildcards. Multiple patterns separated by
                          semicolon (e.g., gpt-4*; *sonnet*; gemini/*).
                        </p>
                      </div>

                      {/* Test Result Display */}
                      {testResult && (
                        <div
                          className={`p-3 rounded-lg border ${
                            testResult.success
                              ? 'bg-emerald-50/70 dark:bg-emerald-900/20 border-emerald-200/70 dark:border-emerald-800/70'
                              : 'bg-red-50/70 dark:bg-red-900/20 border-red-200/70 dark:border-red-800/70'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {testResult.success ? (
                              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <h4
                                className={`text-sm font-medium ${
                                  testResult.success
                                    ? 'text-emerald-800 dark:text-emerald-200'
                                    : 'text-red-800 dark:text-red-200'
                                }`}
                              >
                                {testResult.success
                                  ? '✓ Connection Successful'
                                  : '✗ Connection Failed'}
                              </h4>
                              <p
                                className={`text-xs mt-1 ${
                                  testResult.success
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-red-700 dark:text-red-300'
                                }`}
                              >
                                {testResult.message}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="pt-3 lg:pt-4 border-t border-slate-200/70 dark:border-neutral-800">
                        <div className="flex flex-col sm:flex-row gap-2 lg:gap-3">
                          {/* Test Connection Button */}
                          <button
                            type="button"
                            onClick={testProviderConnection}
                            disabled={testing || !form.name || !form.provider_type}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-3 lg:px-4 py-2 lg:py-2.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                          >
                            {testing ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                            {testing ? 'Testing Connection...' : 'Test Connection'}
                          </button>

                          {/* Save Button */}
                          <button
                            type="button"
                            onClick={onSaveProvider}
                            disabled={
                              saving ||
                              !form.name ||
                              !form.provider_type ||
                              (testResult ? !testResult.success : false)
                            }
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-3 lg:px-4 py-2 lg:py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                          >
                            {saving ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            {saving ? 'Saving...' : form.id ? 'Update Provider' : 'Create Provider'}
                          </button>
                        </div>

                        {testResult && !testResult.success && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1">
                            <span className="inline-block w-1 h-1 bg-amber-500 rounded-full mt-1.5 flex-shrink-0"></span>
                            <span>
                              Test connection first to ensure your settings work correctly
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'search' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Search Engines API Keys
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Store API keys to enable third-party web search tools. Keys are encrypted and
                    scoped to your account.
                  </p>
                </div>
              </div>

              {/* Success Alert for search API key save */}
              {success && (
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 border border-green-200/70 dark:border-green-800/70">
                  <div className="text-sm text-green-700 dark:text-green-400">{success}</div>
                </div>
              )}

              {/* Two-column grid layout on larger screens */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
                {/* SearXNG Configuration Card */}
                <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-5 shadow-sm space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        SearXNG
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Self-hosted metasearch engine
                      </p>
                    </div>
                    <a
                      href="https://github.com/searxng/searxng"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                      title="View SearXNG documentation"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  {/* Base URL Section */}
                  <div className="space-y-3 pb-5 border-b border-slate-200/70 dark:border-neutral-700">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Base URL
                      </label>
                      {initialSearxBaseUrl && searxBaseUrl === initialSearxBaseUrl && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                          <Check className="w-3 h-3" />
                          Saved
                        </span>
                      )}
                    </div>

                    <input
                      type="url"
                      className="w-full px-3 py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                      value={searxBaseUrl}
                      onChange={(e) => {
                        setSearxBaseUrl(e.target.value);
                        setSearxBaseUrlError(null);
                      }}
                      placeholder="https://searx.example/search"
                    />

                    {searxBaseUrlError && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{searxBaseUrlError}</span>
                      </p>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Leave empty to use legacy configuration
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setSearxBaseUrlSaving(true);
                        setSearxBaseUrlError(null);
                        setSuccess(null);
                        try {
                          const trimmedValue = searxBaseUrl.trim();
                          if (trimmedValue && !/^https?:\/\//i.test(trimmedValue)) {
                            throw new Error(
                              'Please enter a valid SearXNG base URL starting with http:// or https://'
                            );
                          }
                          await httpClient.put('/v1/user-settings', {
                            searxng_base_url: trimmedValue || null,
                          });
                          setInitialSearxBaseUrl(trimmedValue);
                          setSuccess('SearXNG base URL saved successfully!');
                        } catch (err: any) {
                          setSearxBaseUrlError(err?.message || 'Failed to save SearXNG base URL');
                        } finally {
                          setSearxBaseUrlSaving(false);
                        }
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-neutral-700 text-white disabled:cursor-not-allowed transition-colors shadow-sm"
                      disabled={searxBaseUrlSaving || searxBaseUrl === initialSearxBaseUrl}
                    >
                      {searxBaseUrlSaving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {searxBaseUrl === initialSearxBaseUrl ? 'Saved' : 'Save URL'}
                        </>
                      )}
                    </button>
                  </div>

                  {/* API Key Section */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        API Key (Optional)
                      </label>
                      {initialSearchApiKeys.searxng &&
                        searchApiKeys.searxng === initialSearchApiKeys.searxng && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                            <Check className="w-3 h-3" />
                            Saved
                          </span>
                        )}
                    </div>

                    <div className="relative">
                      <input
                        type={searchReveal.searxng ? 'text' : 'password'}
                        className="w-full px-3 py-2.5 pr-10 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={searchApiKeys.searxng || ''}
                        onChange={(e) => {
                          setSearchApiKeys((prev) => ({ ...prev, searxng: e.target.value }));
                          setSearchErrors((prev) => ({ ...prev, searxng: null }));
                        }}
                        placeholder="Optional authentication key"
                      />
                      <button
                        type="button"
                        aria-label={searchReveal.searxng ? 'Hide API key' : 'Show API key'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={() =>
                          setSearchReveal((prev) => ({ ...prev, searxng: !prev.searxng }))
                        }
                      >
                        {searchReveal.searxng ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {searchErrors.searxng && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{searchErrors.searxng}</span>
                      </p>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Encrypted and stored securely with your account
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setSearchSaving((prev) => ({ ...prev, searxng: true }));
                        setSearchErrors((prev) => ({ ...prev, searxng: null }));
                        setSuccess(null);
                        try {
                          if (searchApiKeys.searxng && searchApiKeys.searxng.trim() !== '') {
                            await httpClient.put('/v1/user-settings', {
                              searxng_api_key: searchApiKeys.searxng.trim(),
                            });
                            setInitialSearchApiKeys((prev) => ({
                              ...prev,
                              searxng: searchApiKeys.searxng,
                            }));
                            setSuccess('SearXNG API key saved successfully!');
                          } else {
                            setSearchErrors((prev) => ({
                              ...prev,
                              searxng: 'Please enter a valid API key to save',
                            }));
                          }
                        } catch (err: any) {
                          setSearchErrors((prev) => ({
                            ...prev,
                            searxng: err?.message || 'Failed to save key',
                          }));
                        } finally {
                          setSearchSaving((prev) => ({ ...prev, searxng: false }));
                        }
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-neutral-700 text-white disabled:cursor-not-allowed transition-colors shadow-sm"
                      disabled={
                        searchSaving.searxng ||
                        searchApiKeys.searxng === initialSearchApiKeys.searxng
                      }
                    >
                      {searchSaving.searxng ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {searchApiKeys.searxng === initialSearchApiKeys.searxng
                            ? 'Saved'
                            : 'Save Key'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Tavily API Key Card */}
                <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Tavily API Key
                        </label>
                        {initialSearchApiKeys.tavily &&
                          searchApiKeys.tavily === initialSearchApiKeys.tavily && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                              <Check className="w-3 h-3" />
                              Saved
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Real-time web search API
                      </p>
                    </div>
                    <a
                      href="https://tavily.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                      title="Get Tavily API key"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type={searchReveal.tavily ? 'text' : 'password'}
                        className="w-full px-3 py-2.5 pr-10 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={searchApiKeys.tavily || ''}
                        onChange={(e) => {
                          setSearchApiKeys((prev) => ({ ...prev, tavily: e.target.value }));
                          setSearchErrors((prev) => ({ ...prev, tavily: null }));
                        }}
                        placeholder="Paste your Tavily API key here"
                      />
                      <button
                        type="button"
                        aria-label={searchReveal.tavily ? 'Hide API key' : 'Show API key'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={() =>
                          setSearchReveal((prev) => ({ ...prev, tavily: !prev.tavily }))
                        }
                      >
                        {searchReveal.tavily ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {searchErrors.tavily && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{searchErrors.tavily}</span>
                      </p>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Encrypted and stored securely with your account
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setSearchSaving((prev) => ({ ...prev, tavily: true }));
                        setSearchErrors((prev) => ({ ...prev, tavily: null }));
                        setSuccess(null);
                        try {
                          if (searchApiKeys.tavily && searchApiKeys.tavily.trim() !== '') {
                            await httpClient.put('/v1/user-settings', {
                              tavily_api_key: searchApiKeys.tavily.trim(),
                            });
                            setInitialSearchApiKeys((prev) => ({
                              ...prev,
                              tavily: searchApiKeys.tavily,
                            }));
                            setSuccess('Tavily API key saved successfully!');
                          } else {
                            setSearchErrors((prev) => ({
                              ...prev,
                              tavily: 'Please enter a valid API key to save',
                            }));
                          }
                        } catch (err: any) {
                          setSearchErrors((prev) => ({
                            ...prev,
                            tavily: err?.message || 'Failed to save key',
                          }));
                        } finally {
                          setSearchSaving((prev) => ({ ...prev, tavily: false }));
                        }
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-neutral-700 text-white disabled:cursor-not-allowed transition-colors shadow-sm"
                      disabled={
                        searchSaving.tavily || searchApiKeys.tavily === initialSearchApiKeys.tavily
                      }
                    >
                      {searchSaving.tavily ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {searchApiKeys.tavily === initialSearchApiKeys.tavily
                            ? 'Saved'
                            : 'Save Key'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Exa API Key Card */}
                <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Exa API Key
                        </label>
                        {initialSearchApiKeys.exa &&
                          searchApiKeys.exa === initialSearchApiKeys.exa && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                              <Check className="w-3 h-3" />
                              Saved
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Neural search for the web
                      </p>
                    </div>
                    <a
                      href="https://exa.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                      title="Get Exa API key"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type={searchReveal.exa ? 'text' : 'password'}
                        className="w-full px-3 py-2.5 pr-10 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={searchApiKeys.exa || ''}
                        onChange={(e) => {
                          setSearchApiKeys((prev) => ({ ...prev, exa: e.target.value }));
                          setSearchErrors((prev) => ({ ...prev, exa: null }));
                        }}
                        placeholder="Paste your Exa API key here"
                      />
                      <button
                        type="button"
                        aria-label={searchReveal.exa ? 'Hide API key' : 'Show API key'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={() => setSearchReveal((prev) => ({ ...prev, exa: !prev.exa }))}
                      >
                        {searchReveal.exa ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {searchErrors.exa && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{searchErrors.exa}</span>
                      </p>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Encrypted and stored securely with your account
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setSearchSaving((prev) => ({ ...prev, exa: true }));
                        setSearchErrors((prev) => ({ ...prev, exa: null }));
                        setSuccess(null);
                        try {
                          if (searchApiKeys.exa && searchApiKeys.exa.trim() !== '') {
                            await httpClient.put('/v1/user-settings', {
                              exa_api_key: searchApiKeys.exa.trim(),
                            });
                            setInitialSearchApiKeys((prev) => ({
                              ...prev,
                              exa: searchApiKeys.exa,
                            }));
                            setSuccess('Exa API key saved successfully!');
                          } else {
                            setSearchErrors((prev) => ({
                              ...prev,
                              exa: 'Please enter a valid API key to save',
                            }));
                          }
                        } catch (err: any) {
                          setSearchErrors((prev) => ({
                            ...prev,
                            exa: err?.message || 'Failed to save key',
                          }));
                        } finally {
                          setSearchSaving((prev) => ({ ...prev, exa: false }));
                        }
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-neutral-700 text-white disabled:cursor-not-allowed transition-colors shadow-sm"
                      disabled={searchSaving.exa || searchApiKeys.exa === initialSearchApiKeys.exa}
                    >
                      {searchSaving.exa ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {searchApiKeys.exa === initialSearchApiKeys.exa ? 'Saved' : 'Save Key'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-4 border border-slate-200/30 dark:border-neutral-700/30">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <strong className="font-semibold text-slate-700 dark:text-slate-300">
                    Security:
                  </strong>{' '}
                  All API keys are encrypted and stored securely on the server. They are only
                  accessible by your account and never shared or logged.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Advanced Settings
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Configure advanced behavior and limits
                  </p>
                </div>
              </div>

              {/* Success Alert */}
              {success && (
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 border border-green-200/70 dark:border-green-800/70">
                  <div className="text-sm text-green-700 dark:text-green-400">{success}</div>
                </div>
              )}

              {/* Max Tool Iterations Card */}
              <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-5 shadow-sm space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Maximum Tool Call Iterations
                    </label>
                    {maxToolIterations === initialMaxToolIterations && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                        <Check className="w-3 h-3" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Maximum number of consecutive tool calling turns before stopping (1-50)
                  </p>
                </div>

                <div className="space-y-3">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    className="w-full px-3 py-2.5 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                    value={maxToolIterations}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value)) {
                        setMaxToolIterations(Math.max(1, Math.min(50, value)));
                      }
                      setMaxToolIterationsError(null);
                    }}
                  />

                  {maxToolIterationsError && (
                    <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{maxToolIterationsError}</span>
                    </p>
                  )}

                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Default is 10. This prevents infinite loops when the AI continuously requests
                    tool calls. Increase for complex tasks requiring many tool iterations, decrease
                    to save on API costs.
                  </p>

                  <button
                    type="button"
                    onClick={async () => {
                      setMaxToolIterationsSaving(true);
                      setMaxToolIterationsError(null);
                      setSuccess(null);
                      try {
                        await httpClient.put('/v1/user-settings', {
                          max_tool_iterations: maxToolIterations,
                        });
                        setInitialMaxToolIterations(maxToolIterations);
                        setSuccess('Maximum tool iterations saved successfully!');
                      } catch (err: any) {
                        setMaxToolIterationsError(
                          err?.message || 'Failed to save maximum tool iterations'
                        );
                      } finally {
                        setMaxToolIterationsSaving(false);
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-neutral-700 text-white disabled:cursor-not-allowed transition-colors shadow-sm"
                    disabled={
                      maxToolIterationsSaving || maxToolIterations === initialMaxToolIterations
                    }
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

              <div className="bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-4 border border-slate-200/30 dark:border-neutral-700/30">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <strong className="font-semibold text-slate-700 dark:text-slate-300">
                    Note:
                  </strong>{' '}
                  These settings affect how the AI handles tool execution. Changes take effect
                  immediately for new conversations.
                </p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[10001] overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <div
              className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm transition-opacity"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <div className="relative transform overflow-hidden rounded-lg bg-white dark:bg-slate-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
              <div className="sm:flex sm:items-start">
                <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20 sm:mx-0 sm:h-10 sm:w-10">
                  <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                  <h3 className="text-base font-semibold leading-6 text-slate-900 dark:text-slate-100">
                    Delete Provider
                  </h3>
                  <div className="mt-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Are you sure you want to permanently delete &quot;{form.name}&quot;? This
                      action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto"
                  onClick={() => onDeleteProvider()}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="mt-3 inline-flex w-full justify-center rounded-md bg-white dark:bg-slate-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm ring-1 ring-inset ring-slate-300 dark:ring-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 sm:mt-0 sm:w-auto"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
