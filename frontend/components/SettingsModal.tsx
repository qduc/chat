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
        res = await fetch(`${apiBase}/v1/providers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: form.name || undefined }),
        });
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
        maxWidthClassName="max-w-4xl"
        title={<div className="flex items-center gap-2"><Cog className="w-5 h-5" /> Settings</div> as any}
      >
        <div className="flex flex-col gap-6">
          {/* Tab Navigation */}
          <div className="border-b border-slate-200 dark:border-slate-700">
            <nav className="-mb-px flex space-x-8" aria-label="Settings tabs">
              <button
                onClick={() => setActiveTab('providers')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'providers'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
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
            <div className="space-y-6">
              {/* Header with refresh button */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">AI Providers</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Manage your AI provider configurations</p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
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
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                  <div className="text-sm text-red-700 dark:text-red-400">{error}</div>
                </div>
              )}

              {/* Main Content - Responsive Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Provider List */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Existing Providers</h4>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add New
                    </button>
                  </div>
                  
                  <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 max-h-96 overflow-auto">
                    {loadingProviders && (
                      <div className="p-4 text-sm text-slate-500 text-center">Loading providers...</div>
                    )}
                    {!loadingProviders && providers.length === 0 && (
                      <div className="p-8 text-center">
                        <Database className="mx-auto h-12 w-12 text-slate-400 mb-3" />
                        <p className="text-sm text-slate-500">No providers configured</p>
                        <p className="text-xs text-slate-400 mt-1">Click &ldquo;Add New&rdquo; to get started</p>
                      </div>
                    )}
                    {providers.map((p) => (
                      <div
                        key={p.id}
                        className={`w-full p-4 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors ${
                          selectedId === p.id ? 'bg-emerald-50 dark:bg-emerald-900/20 border-r-2 border-emerald-500' : ''
                        }`}
                      >
                        <button
                          type="button"
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
                          className="w-full text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 rounded-md"
                        >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                              {p.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {p.provider_type}
                            </p>
                          </div>
                          <div className="ml-3 flex items-center gap-2">
                            {toggleLoading.has(p.id) ? (
                              <div className="flex items-center justify-center w-11 h-6">
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
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
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Provider Editor */}
                <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {form.id ? 'Edit Provider' : 'New Provider'}
                    </h4>
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

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="provider-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Name *
                      </label>
                      <input
                        id="provider-name"
                        type="text"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="OpenAI"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="provider-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Type *
                      </label>
                      <select
                        id="provider-type"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        value={form.provider_type}
                        onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                        required
                      >
                        <option value="openai">OpenAI Compatible</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="base-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Base URL
                      </label>
                      <input
                        id="base-url"
                        type="url"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        value={form.base_url}
                        onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                        placeholder="https://api.openai.com/v1"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">Leave empty to use the default OpenAI endpoint</p>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        API Key
                      </label>
                      <input
                        id="api-key"
                        type="password"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        value={form.api_key || ''}
                        onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                        placeholder={form.id ? "Leave blank to keep existing key" : "sk-..."}
                      />
                      {form.id && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Leave blank to keep the existing API key</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="default-model" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Default Model
                      </label>
                      <input
                        id="default-model"
                        type="text"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        value={form.default_model || ''}
                        onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                        placeholder="gpt-4o-mini"
                      />
                    </div>

                    <div className="flex items-center justify-between py-2">
                      <div>
                        <label htmlFor="provider-enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Enable Provider
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Allow this provider to be used for chat completions</p>
                      </div>
                      <Toggle
                        id="provider-enabled"
                        ariaLabel="Enable provider"
                        checked={form.enabled}
                        onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                      />
                    </div>

                    {/* Test Result Display */}
                    {testResult && (
                      <div className={`p-4 rounded-md border ${
                        testResult.success
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      }`}>
                        <div className="flex items-start gap-3">
                          {testResult.success ? (
                            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <h4 className={`text-sm font-medium ${
                              testResult.success
                                ? 'text-emerald-800 dark:text-emerald-200'
                                : 'text-red-800 dark:text-red-200'
                            }`}>
                              {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                            </h4>
                            <p className={`text-sm mt-1 ${
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

                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                      {/* Test Connection Button */}
                      <button
                        type="button"
                        onClick={testProviderConnection}
                        disabled={testing || !form.name || !form.provider_type}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {testing ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                        {testing ? 'Testing...' : 'Test Connection'}
                      </button>

                      {/* Save Button */}
                      <button
                        type="button"
                        onClick={onSaveProvider}
                        disabled={saving || !form.name || !form.provider_type}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {saving ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {saving ? 'Saving...' : form.id ? 'Update Provider' : 'Create Provider'}
                      </button>
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
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
                      Are you sure you want to delete &ldquo;{form.name}&rdquo;? This action cannot be undone.
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
