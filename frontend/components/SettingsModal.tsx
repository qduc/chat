"use client";
import React from 'react';
import { Cog, Database, Plus, Save, RefreshCw, Trash2, Zap, CheckCircle, XCircle } from 'lucide-react';
import Modal from './ui/Modal';
import Toggle from './ui/Toggle';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({
  open,
  onClose,
}: SettingsModalProps) {
  // --- Providers management state ---
  type ProviderRow = {
    id: string;
    name: string;
    provider_type: string;
    base_url?: string | null;
    enabled?: number | boolean;
    extra_headers?: Record<string, any>;
    metadata?: Record<string, any>;
    created_at?: string;
    updated_at?: string;
  };

  const apiBase = (process.env.NEXT_PUBLIC_API_BASE as string) ?? 'http://localhost:3001';
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
    default_model?: string;
  }>({ name: '', provider_type: 'openai', base_url: '', enabled: true });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('providers');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [toggleLoading, setToggleLoading] = React.useState<Set<string>>(new Set());

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
    setForm({ name: '', provider_type: 'openai', base_url: '', enabled: true, api_key: '', default_model: '' });
    setTestResult(null);
  }, []);

  const populateFormFromRow = React.useCallback((r: ProviderRow) => {
    setForm({
      id: r.id,
      name: r.name,
      provider_type: r.provider_type,
      base_url: r.base_url || '',
      enabled: Boolean(r.enabled),
      api_key: '', // not returned by API; allow setting new value
      default_model: (r.metadata as any)?.default_model || '',
    });
    setTestResult(null);
  }, []);

  const fetchProviders = React.useCallback(async () => {
    try {
      setLoadingProviders(true);
      setError(null);
      const res = await fetch(`${apiBase}/v1/providers`);
      if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
      const json = await res.json();
      const rows: ProviderRow[] = Array.isArray(json.providers) ? json.providers : [];
      setProviders(rows);
      if (rows.length && selectedId) {
        const cur = rows.find((r) => r.id === selectedId);
        if (cur) populateFormFromRow(cur);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load providers');
    } finally {
      setLoadingProviders(false);
    }
  }, [apiBase, selectedId, populateFormFromRow]);

  React.useEffect(() => {
    if (open) fetchProviders();
  }, [open, fetchProviders]);

  // Clear test results when form changes (but not immediately after setting them)
  const [lastTestTime, setLastTestTime] = React.useState(0);

  React.useEffect(() => {
    // Don't clear results if we just set them (within last 500ms)
    if (testResult && Date.now() - lastTestTime > 500) {
      setTestResult(null);
    }
  }, [form.name, form.provider_type, form.base_url, form.api_key, form.default_model]);

  const onSelectProvider = (r: ProviderRow) => {
    setSelectedId(r.id);
    populateFormFromRow(r);
  };

  async function onSaveProvider() {
    try {
      setSaving(true);
      setError(null);
      const payload: any = {
        name: form.name,
        provider_type: form.provider_type,
        base_url: form.base_url || null,
        enabled: form.enabled,
        metadata: { default_model: form.default_model || null },
      };
      if (form.api_key) payload.api_key = form.api_key;
      let res: Response;
      if (form.id) {
        res = await fetch(`${apiBase}/v1/providers/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // Generate user-friendly ID from name for new providers
        let generatedId = generateIdFromName(form.name);
        let attempt = 0;
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
          const idToTry = attempt === 0 ? generatedId : `${generatedId}-${attempt}`;
          res = await fetch(`${apiBase}/v1/providers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, id: idToTry }),
          });

          if (res.ok) {
            break; // Success, exit retry loop
          }

          const err = await res.json().catch(() => ({}));
          if (res.status === 409 && attempt < maxAttempts - 1) {
            // Conflict error, try with next suffix
            attempt++;
            continue;
          } else {
            // Other error or max attempts reached
            throw new Error(err?.message || `Save failed (${res.status})`);
          }
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `Save failed (${res.status})`);
      }
      await fetchProviders();
    } catch (e: any) {
      setError(e?.message || 'Failed to save provider');
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
      const res = await fetch(`${apiBase}/v1/providers/${target}`, { method: 'DELETE' });
      if (!(res.status === 204 || res.ok)) throw new Error(`Delete failed (${res.status})`);
      resetForm();
      await fetchProviders();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete provider');
    } finally {
      setSaving(false);
    }
  }

  const confirmDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleQuickToggle = React.useCallback(async (providerId: string, enabled: boolean) => {
    // Add to loading set
    setToggleLoading(prev => new Set([...prev, providerId]));

    // Optimistic update
    setProviders(prev => prev.map(p =>
      p.id === providerId ? { ...p, enabled: enabled ? 1 : 0 } : p
    ));

    try {
      setError(null);
      const response = await fetch(`${apiBase}/v1/providers/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.message || `Toggle failed (${response.status})`);
      }

      // Refresh providers to get updated data
      await fetchProviders();
    } catch (error: any) {
      // Revert on failure
      setProviders(prev => prev.map(p =>
        p.id === providerId ? { ...p, enabled: enabled ? 0 : 1 } : p
      ));
      const provider = providers.find(p => p.id === providerId);
      setError(`Failed to ${enabled ? 'enable' : 'disable'} ${provider?.name || 'provider'}: ${error?.message || 'Unknown error'}`);
    } finally {
      // Remove from loading set
      setToggleLoading(prev => {
        const newSet = new Set(prev);
        newSet.delete(providerId);
        return newSet;
      });
    }
  }, [apiBase, providers, fetchProviders]);

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
      const errorResult = { success: false, message: 'Please enter an API key to test the connection' };
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
          metadata: { default_model: form.default_model || null },
        };
        endpoint = `${apiBase}/v1/providers/test`;
      } else {
        // Test existing provider using stored credentials
        endpoint = `${apiBase}/v1/providers/${form.id}/test`;
        testPayload = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url || null,
          metadata: { default_model: form.default_model || null },
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.message || `Test failed (${res.status})`);
      }

      const result = await res.json();

      const successResult = {
        success: true,
        message: result?.message || 'Connection successful! Provider is working correctly.',
      };
      setLastTestTime(Date.now());
      setTestResult(successResult);
    } catch (e: any) {
      const errorResult = {
        success: false,
        message: e?.message || 'Connection test failed. Please check your configuration.',
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
        maxWidthClassName="max-w-6xl"
        title={<div className="flex items-center gap-2"><Cog className="w-4 h-4" /> Settings</div> as any}
      >
        <div className="flex flex-col gap-3">
          {/* Tab Navigation */}
          <div>
            <nav className="flex items-center gap-2 bg-slate-50 dark:bg-neutral-900/40 rounded-lg p-1" aria-label="Settings tabs">
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
              {/* Future tabs can be added here */}
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'providers' && (
            <div className="space-y-3">
              {/* Header with refresh button */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">AI Providers</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Manage your AI provider configurations</p>
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

              {/* Main Content - Responsive Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Provider List Section */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-3 border border-slate-200/30 dark:border-neutral-700/30">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your Providers</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage and toggle existing configurations</p>
                      </div>
                      <button
                        type="button"
                        onClick={resetForm}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-slate-600 hover:bg-slate-700 text-white transition-colors font-medium"
                      >
                        <Plus className="w-4 h-4" />
                        Add New
                      </button>
                    </div>

                    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 divide-y divide-slate-200/60 dark:divide-neutral-700 max-h-64 overflow-auto shadow-sm">
                    {loadingProviders && (
                      <div className="p-3 text-sm text-slate-500 text-center">Loading providers...</div>
                    )}
                    {!loadingProviders && providers.length === 0 && (
                      <div className="p-6 text-center">
                        <Database className="mx-auto h-10 w-10 text-slate-400 mb-3" />
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No AI providers yet</p>
                        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Click "Add New" to configure your first AI provider</p>
                      </div>
                    )}
                    {providers.map((p) => (
                      <div
                        key={p.id}
                        className={`w-full p-2 sm:p-3 transition-colors ${
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
                <div className="lg:col-span-3 bg-slate-50/60 dark:bg-neutral-800/30 rounded-lg p-4 border border-slate-200/30 dark:border-neutral-700/30">
                  <div className="bg-white dark:bg-neutral-900 rounded-lg border border-slate-200/70 dark:border-neutral-700 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {form.id ? 'Edit Provider Configuration' : 'Add New Provider'}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {form.id ? 'Update settings for this provider' : 'Configure a new AI provider for your account'}
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

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label htmlFor="provider-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Name *
                      </label>
                      <input
                        id="provider-name"
                        type="text"
                        className="w-full px-3 py-2 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g., OpenAI, Anthropic, Custom Provider"
                        required
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">Choose a descriptive name to identify this provider</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="provider-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Type *
                      </label>
                      <select
                        id="provider-type"
                        className="w-full px-3 py-2 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={form.provider_type}
                        onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                        required
                      >
                        <option value="openai">OpenAI Compatible</option>
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Compatible with OpenAI API format (ChatGPT, Claude, most providers)</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="base-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Base URL
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">(Optional)</span>
                      </label>
                      <input
                        id="base-url"
                        type="url"
                        className="w-full px-3 py-2 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={form.base_url}
                        onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                        placeholder="https://api.openai.com/v1 (auto-filled if empty)"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Custom API endpoint. Leave empty for OpenAI's default endpoint.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        API Key {!form.id && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        id="api-key"
                        type="password"
                        className="w-full px-3 py-2 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={form.api_key || ''}
                        onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                        placeholder={form.id ? "••••••••••••••••••••" : "sk-proj-abc123... or your provider's API key"}
                        required={!form.id}
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {form.id
                          ? "Leave blank to keep existing key. Keys are stored securely and encrypted."
                          : "Your API key will be encrypted and stored securely. Never shared or logged."
                        }
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="default-model" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Default Model
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">(Optional)</span>
                      </label>
                      <input
                        id="default-model"
                        type="text"
                        className="w-full px-3 py-2 border border-slate-200/70 dark:border-neutral-800 rounded-lg bg-white/80 dark:bg-neutral-900/70 text-sm focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 transition-colors"
                        value={form.default_model || ''}
                        onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                        placeholder="gpt-4o-mini, claude-3-5-sonnet-20241022, etc."
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Fallback model if none specified. Use exact model name from provider docs.
                      </p>
                    </div>

                    {/* Test Result Display */}
                    {testResult && (
                      <div className={`p-3 rounded-lg border ${
                        testResult.success
                          ? 'bg-emerald-50/70 dark:bg-emerald-900/20 border-emerald-200/70 dark:border-emerald-800/70'
                          : 'bg-red-50/70 dark:bg-red-900/20 border-red-200/70 dark:border-red-800/70'
                      }`}>
                        <div className="flex items-start gap-2">
                          {testResult.success ? (
                            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <h4 className={`text-sm font-medium ${
                              testResult.success
                                ? 'text-emerald-800 dark:text-emerald-200'
                                : 'text-red-800 dark:text-red-200'
                            }`}>
                              {testResult.success ? '✓ Connection Successful' : '✗ Connection Failed'}
                            </h4>
                            <p className={`text-xs mt-1 ${
                              testResult.success
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-red-700 dark:text-red-300'
                            }`}>
                              {testResult.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-200/70 dark:border-neutral-800">
                      <div className="flex flex-col sm:flex-row gap-3">
                        {/* Test Connection Button */}
                        <button
                          type="button"
                          onClick={testProviderConnection}
                          disabled={testing || !form.name || !form.provider_type}
                          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
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
                          disabled={saving || !form.name || !form.provider_type || (testResult ? !testResult.success : false)}
                          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
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
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                          <span className="inline-block w-1 h-1 bg-amber-500 rounded-full"></span>
                          Test connection first to ensure your settings work correctly
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[10001] overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" onClick={() => setShowDeleteConfirm(false)} />
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
                      Are you sure you want to permanently delete "{form.name}"? This action cannot be undone.
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
