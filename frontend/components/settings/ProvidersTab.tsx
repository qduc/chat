'use client';

import React from 'react';
import {
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
} from 'lucide-react';
import Toggle from '../ui/Toggle';
import { httpClient, HttpError, resolveApiBase } from '../../lib';
import { useToast } from '../ui/Toast';

interface ProvidersTabProps {
  isVisible: boolean;
  isOpen: boolean;
  onProvidersChanged?: () => void;
}

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

export default function ProvidersTab({ isVisible, isOpen, onProvidersChanged }: ProvidersTabProps) {
  const apiBase = React.useMemo(() => resolveApiBase(), []);
  const { showToast } = useToast();

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
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    null
  );
  const [toggleLoading, setToggleLoading] = React.useState<Set<string>>(new Set());
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [lastTestTime, setLastTestTime] = React.useState(0);

  // Generate user-friendly ID from provider name
  const generateIdFromName = React.useCallback((name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
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
      showToast({ message, variant: 'error' });
    } finally {
      setLoadingProviders(false);
    }
  }, [apiBase, selectedId, populateFormFromRow, showToast]);

  // Initial fetch
  React.useEffect(() => {
    if (isOpen) {
      fetchProviders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Clear test results logic
  React.useEffect(() => {
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

  const onSelectProvider = (r: ProviderRow) => {
    setSelectedId(r.id);
    populateFormFromRow(r);
  };

  async function onSaveProvider() {
    try {
      setSaving(true);
      const payload: any = {
        name: form.name,
        provider_type: form.provider_type,
        base_url: form.base_url || null,
        enabled: form.enabled,
        metadata: { model_filter: form.model_filter || null },
      };
      if (form.api_key) payload.api_key = form.api_key;

      if (form.id) {
        await httpClient.put(`${apiBase}/v1/providers/${form.id}`, payload);
      } else {
        const generatedId = generateIdFromName(form.name);
        let attempt = 0;
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
          const idToTry = attempt === 0 ? generatedId : `${generatedId}-${attempt}`;
          try {
            await httpClient.post(`${apiBase}/v1/providers`, { ...payload, id: idToTry });
            break;
          } catch (error) {
            if (error instanceof HttpError && error.status === 409 && attempt < maxAttempts - 1) {
              attempt++;
              continue;
            } else {
              throw error;
            }
          }
        }
      }
      await fetchProviders();
      if (onProvidersChanged) onProvidersChanged();
      showToast({
        message: form.id ? 'Provider updated successfully!' : 'Provider created successfully!',
        variant: 'success',
      });
    } catch (e: any) {
      const message = e instanceof HttpError ? e.message : e?.message || 'Failed to save provider';
      showToast({ message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteProvider(id?: string) {
    const target = id || form.id;
    if (!target) return;
    setShowDeleteConfirm(false);
    try {
      setSaving(true);
      await httpClient.delete(`${apiBase}/v1/providers/${target}`);
      resetForm();
      await fetchProviders();
      if (onProvidersChanged) onProvidersChanged();
      showToast({ message: 'Provider deleted successfully!', variant: 'success' });
    } catch (e: any) {
      const message =
        e instanceof HttpError ? e.message : e?.message || 'Failed to delete provider';
      showToast({ message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const handleQuickToggle = React.useCallback(
    async (providerId: string, enabled: boolean) => {
      setToggleLoading((prev) => new Set([...prev, providerId]));
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, enabled: enabled ? 1 : 0 } : p))
      );

      try {
        await httpClient.put(`${apiBase}/v1/providers/${providerId}`, { enabled });
        showToast({
          message: `Provider ${enabled ? 'enabled' : 'disabled'} successfully!`,
          variant: 'success',
        });
        if (onProvidersChanged) onProvidersChanged();
      } catch (error: any) {
        setProviders((prev) =>
          prev.map((p) => (p.id === providerId ? { ...p, enabled: enabled ? 0 : 1 } : p))
        );
        const provider = providers.find((p) => p.id === providerId);
        const message =
          error instanceof HttpError ? error.message : error?.message || 'Unknown error';
        showToast({
          message: `Failed to ${enabled ? 'enable' : 'disable'} ${provider?.name || 'provider'}: ${message}`,
          variant: 'error',
        });
      } finally {
        setToggleLoading((prev) => {
          const newSet = new Set(prev);
          newSet.delete(providerId);
          return newSet;
        });
      }
    },
    [apiBase, providers, onProvidersChanged, showToast]
  );

  async function testProviderConnection() {
    if (!form.name || !form.provider_type) {
      const errorResult = { success: false, message: 'Please fill in required fields first' };
      setLastTestTime(Date.now());
      setTestResult(errorResult);
      return;
    }

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

      let testPayload;
      let endpoint;

      if (hasApiKey) {
        testPayload = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url || null,
          api_key: form.api_key,
          metadata: { model_filter: form.model_filter || null },
        };
        endpoint = `${apiBase}/v1/providers/test`;
      } else {
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
    <div className={isVisible ? 'space-y-3' : 'hidden'}>
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">AI Providers</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Manage your AI provider configurations
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-2 py-1 text-sm rounded-lg border border-zinc-200/70 dark:border-zinc-800 bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
          onClick={fetchProviders}
          disabled={loadingProviders}
          title="Refresh providers list"
        >
          <RefreshCw className={`w-4 h-4 ${loadingProviders ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main Content - Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 lg:max-h-[600px]">
        {/* Provider List Section */}
        <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto lg:pr-2">
          <div className="bg-zinc-50/60 dark:bg-zinc-900/30 rounded-xl p-3 border border-zinc-200/30 dark:border-zinc-800/30">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Your Providers
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Manage and toggle existing configurations
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 divide-y divide-zinc-200/60 dark:divide-zinc-800 shadow-sm">
              {loadingProviders && (
                <div className="p-3 text-sm text-zinc-500 text-center">Loading providers...</div>
              )}
              {!loadingProviders && providers.length === 0 && (
                <div className="p-6 text-center">
                  <Database className="mx-auto h-10 w-10 text-zinc-400 mb-3" />
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    No AI providers yet
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1">
                    Click &quot;Add New&quot; to configure your first AI provider
                  </p>
                </div>
              )}
              {providers.map((p) => (
                <div
                  key={p.id}
                  className={`w-full p-2.5 lg:p-3 transition-colors ${
                    selectedId === p.id
                      ? 'bg-zinc-50 dark:bg-zinc-800/60'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
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
                    className="w-full text-left focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700 focus:ring-offset-2 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate capitalize">
                          {p.name}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {p.provider_type}
                        </p>
                      </div>
                      <div className="ml-3 flex items-center gap-2">
                        {toggleLoading.has(p.id) ? (
                          <div className="flex items-center justify-center w-9 h-5">
                            <RefreshCw className="w-4 h-4 animate-spin text-zinc-500 dark:text-zinc-400" />
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
        <div className="lg:col-span-2 bg-zinc-50/60 dark:bg-zinc-900/30 rounded-xl p-3 lg:p-4 border border-zinc-200/30 dark:border-zinc-800/30 lg:overflow-y-auto lg:pr-2">
          {form.id && (
            <>
              {/* Add New button moved above the form */}
              <div className="flex justify-end mb-3 lg:mb-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-800 text-white transition-colors font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add New
                </button>
              </div>
            </>
          )}

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/70 dark:border-zinc-800 p-3 lg:p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 lg:mb-5 gap-2">
              <div>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {form.id ? 'Edit Provider Configuration' : 'Add New Provider'}
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {form.id
                    ? 'Update settings for this provider'
                    : 'Configure a new AI provider for your account'}
                </p>
              </div>
              {form.id && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
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
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Provider Name *
                </label>
                <input
                  id="provider-name"
                  type="text"
                  className="w-full px-3 py-2 lg:py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., OpenAI, Anthropic, Custom Provider"
                  required
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Choose a descriptive name to identify this provider
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="provider-type"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Provider Type *
                </label>
                <select
                  id="provider-type"
                  className="w-full px-3 py-2 lg:py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                  required
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                </select>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
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
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Base URL
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-2">
                      (Optional)
                    </span>
                  </label>
                  <input
                    id="base-url"
                    type="url"
                    className="w-full px-3 py-2 lg:py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="https://api.openai.com/v1 (auto-filled if empty)"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Custom API endpoint. Leave empty for OpenAI&apos;s default endpoint.
                  </p>
                </div>
              )}

              <div className="space-y-1.5 relative">
                <label
                  htmlFor="api-key"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  API Key {!form.id && <span className="text-red-500">*</span>}
                </label>
                <input
                  id="api-key"
                  type={showApiKey ? 'text' : 'password'}
                  className="w-full px-3 py-2 lg:py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors pr-10"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {form.id
                    ? 'Leave blank to keep existing key. Keys are stored securely and encrypted.'
                    : 'Your API key will be encrypted and stored securely. Never shared or logged.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="model-filter"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Model Filter
                  <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-2">
                    (Optional)
                  </span>
                </label>
                <input
                  id="model-filter"
                  type="text"
                  className="w-full px-3 py-2 lg:py-2.5 border border-zinc-200/70 dark:border-zinc-800 rounded-lg bg-white/80 dark:bg-zinc-900/70 text-sm focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 focus:border-zinc-400 transition-colors"
                  value={form.model_filter || ''}
                  onChange={(e) => setForm((f) => ({ ...f, model_filter: e.target.value }))}
                  placeholder="gpt-4*; *sonnet*; gemini/*"
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
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
                        {testResult.success ? '✓ Connection Successful' : '✗ Connection Failed'}
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

              <div className="pt-3 lg:pt-4 border-t border-zinc-200/70 dark:border-zinc-800">
                <div className="flex flex-col sm:flex-row gap-2 lg:gap-3">
                  {/* Test Connection Button */}
                  <button
                    type="button"
                    onClick={testProviderConnection}
                    disabled={testing || !form.name || !form.provider_type}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-3 lg:px-4 py-2 lg:py-2.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
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
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-3 lg:px-4 py-2 lg:py-2.5 text-sm font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
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
                    <span>Test connection first to ensure your settings work correctly</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
