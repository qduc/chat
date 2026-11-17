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
import { Button, IconButton } from '../ui/Button';
import { Field, Input, NativeSelect } from '../ui/Input';
import { Dialog, DialogContent } from '../ui/Dialog';
import { cn } from '../../lib/cn';
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
  }>({ name: '', provider_type: 'openai-completions', base_url: '', enabled: true });

  const [saving, setSaving] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    null
  );
  const [toggleLoading, setToggleLoading] = React.useState<Set<string>>(new Set());
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [lastTestTime, setLastTestTime] = React.useState(0);
  const isLlamaCppProvider = form.provider_type === 'llama-cpp';
  const supportsCustomBaseUrl = form.provider_type.startsWith('openai') || isLlamaCppProvider;
  const apiKeyRequired = !form.id && !isLlamaCppProvider;

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
      provider_type: 'openai-completions',
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

    if (!hasApiKey && !isExistingProvider && !isLlamaCppProvider) {
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

      if (hasApiKey || (!isExistingProvider && isLlamaCppProvider)) {
        testPayload = {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url || null,
          api_key: form.api_key || null,
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

  const providerTypeDescription =
    form.provider_type === 'anthropic'
      ? 'Native Anthropic Claude API support with Messages API'
      : form.provider_type === 'gemini'
        ? 'Native Google Gemini API support'
        : form.provider_type === 'llama-cpp'
          ? 'OpenAI-compatible llama.cpp server with chat template reasoning controls'
          : form.provider_type === 'openai-responses'
            ? 'Use OpenAI Responses API (/v1/responses) for advanced features'
            : 'Use Chat Completions API (/v1/chat/completions) for broad compatibility';

  return (
    <div className={isVisible ? 'flex flex-col gap-6' : 'hidden'}>
      {/* Header with refresh button */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-fg">AI Providers</h3>
          <p className="text-sm text-fg-muted">Manage your AI provider configurations</p>
        </div>
        <Button
          size="sm"
          onClick={fetchProviders}
          disabled={loadingProviders}
          title="Refresh providers list"
        >
          <RefreshCw className={loadingProviders ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Provider list */}
        <section
          className="flex flex-col gap-3 lg:col-span-1"
          aria-labelledby="providers-list-heading"
        >
          <div className="flex flex-col gap-1">
            <h4 id="providers-list-heading" className="text-sm font-medium text-fg">
              Your Providers
            </h4>
            <p className="text-sm text-fg-muted">Manage and toggle existing configurations</p>
          </div>

          <div className="overflow-hidden rounded-card border border-line lg:max-h-150 lg:overflow-y-auto">
            {loadingProviders && (
              <p className="p-3 text-center text-sm text-fg-muted">Loading providers...</p>
            )}
            {!loadingProviders && providers.length === 0 && (
              <div className="flex flex-col items-center gap-1 p-6 text-center">
                <Database aria-hidden="true" className="mb-2 size-10 text-fg-subtle" />
                <p className="text-sm font-medium text-fg-muted">No AI providers yet</p>
                <p className="text-sm text-fg-subtle">
                  Click &quot;Add New&quot; to configure your first AI provider
                </p>
              </div>
            )}
            {providers.length > 0 && (
              <ul className="divide-y divide-line">
                {providers.map((p) => {
                  const isSelected = selectedId === p.id;
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 pr-3 transition-colors',
                        isSelected ? 'bg-emphasis' : 'hover:bg-muted'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectProvider(p)}
                        onKeyDown={(e) => {
                          if (e.key === 't' || e.key === 'T') {
                            e.preventDefault();
                            handleQuickToggle(p.id, !p.enabled);
                          }
                        }}
                        aria-current={isSelected ? 'true' : undefined}
                        className="flex min-w-0 flex-1 flex-col gap-1 py-3 pl-3 text-left touch-target focus-ring-inset"
                      >
                        <span className="truncate text-sm font-medium text-fg capitalize">
                          {p.name}
                        </span>
                        <span className="text-xs text-fg-muted">{p.provider_type}</span>
                      </button>
                      {toggleLoading.has(p.id) ? (
                        <span className="flex h-6 w-10 items-center justify-center">
                          <RefreshCw
                            aria-label="Updating provider"
                            className="size-4 animate-spin text-fg-muted"
                          />
                        </span>
                      ) : (
                        <Toggle
                          checked={Boolean(p.enabled)}
                          onChange={(enabled) => handleQuickToggle(p.id, enabled)}
                          disabled={saving}
                          ariaLabel={`${p.enabled ? 'Disable' : 'Enable'} ${p.name} provider`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Provider configuration */}
        <section
          className="flex flex-col gap-6 lg:col-span-2"
          aria-labelledby="provider-form-heading"
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex flex-col gap-1">
              <h4 id="provider-form-heading" className="text-sm font-medium text-fg">
                {form.id ? 'Edit Provider Configuration' : 'Add New Provider'}
              </h4>
              <p className="text-sm text-fg-muted">
                {form.id
                  ? 'Update settings for this provider'
                  : 'Configure a new AI provider for your account'}
              </p>
            </div>
            {form.id && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  <Plus />
                  Add New
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <Field
              label="Provider Name *"
              description="Choose a descriptive name to identify this provider"
            >
              <Input
                id="provider-name"
                type="text"
                autoComplete="off"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., OpenAI, Anthropic, Custom Provider"
                required
              />
            </Field>

            <div className="flex flex-col gap-2">
              <label htmlFor="provider-type" className="text-sm font-medium text-fg">
                Provider Type *
              </label>
              <NativeSelect
                id="provider-type"
                className="w-full"
                aria-describedby="provider-type-description"
                value={form.provider_type}
                onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                required
              >
                <option value="openai-responses">OpenAI Responses API</option>
                <option value="openai-completions">OpenAI Chat Completions</option>
                <option value="llama-cpp">llama.cpp</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
              </NativeSelect>
              <p id="provider-type-description" className="text-xs text-fg-muted">
                {providerTypeDescription}
              </p>
            </div>

            {supportsCustomBaseUrl && (
              <Field
                label="Base URL"
                hint="(Optional)"
                description={
                  isLlamaCppProvider
                    ? 'llama.cpp server endpoint. Leave empty for the local default.'
                    : "Custom API endpoint. Leave empty for OpenAI's default endpoint."
                }
              >
                <Input
                  id="base-url"
                  type="url"
                  autoComplete="off"
                  value={form.base_url}
                  onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                  placeholder={
                    isLlamaCppProvider
                      ? 'http://localhost:8080/v1 (auto-filled if empty)'
                      : 'https://api.openai.com/v1 (auto-filled if empty)'
                  }
                />
              </Field>
            )}

            <Field
              label={apiKeyRequired ? 'API Key *' : 'API Key'}
              description={
                form.id
                  ? 'Leave blank to keep existing key. Keys are stored securely and encrypted.'
                  : 'Your API key will be encrypted and stored securely. Never shared or logged.'
              }
            >
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pr-8"
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
                <IconButton
                  label={showApiKey ? 'Hide API key' : 'Show API key'}
                  size="sm"
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff /> : <Eye />}
                </IconButton>
              </div>
            </Field>

            <Field
              label="Model Filter"
              hint="(Optional)"
              description="Filter models in selector using wildcards. Multiple patterns separated by semicolon (e.g., gpt-4*; *sonnet*; gemini/*)."
            >
              <Input
                id="model-filter"
                type="text"
                autoComplete="off"
                value={form.model_filter || ''}
                onChange={(e) => setForm((f) => ({ ...f, model_filter: e.target.value }))}
                placeholder="gpt-4*; *sonnet*; gemini/*"
              />
            </Field>

            {testResult && (
              <div role="status" className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle aria-hidden="true" className="size-4 shrink-0 text-success" />
                ) : (
                  <XCircle aria-hidden="true" className="size-4 shrink-0 text-danger" />
                )}
                <div className="flex flex-1 flex-col gap-1">
                  <h4
                    className={cn(
                      'text-sm font-medium',
                      testResult.success ? 'text-success' : 'text-danger'
                    )}
                  >
                    {testResult.success ? '✓ Connection Successful' : '✗ Connection Failed'}
                  </h4>
                  <p className="text-xs text-fg-muted">{testResult.message}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={testProviderConnection}
                  disabled={testing || !form.name || !form.provider_type}
                >
                  {testing ? <RefreshCw className="animate-spin" /> : <Zap />}
                  {testing ? 'Testing Connection...' : 'Test Connection'}
                </Button>
                <Button
                  variant="primary"
                  onClick={onSaveProvider}
                  disabled={
                    saving ||
                    !form.name ||
                    !form.provider_type ||
                    (testResult ? !testResult.success : false)
                  }
                >
                  {saving ? <RefreshCw className="animate-spin" /> : <Save />}
                  {saving ? 'Saving...' : form.id ? 'Update Provider' : 'Create Provider'}
                </Button>
              </div>

              {testResult && !testResult.success && (
                <p className="text-xs text-warning sm:text-right">
                  Test connection first to ensure your settings work correctly
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent
          title="Delete Provider"
          size="sm"
          footer={
            <>
              <Button onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => onDeleteProvider()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            Are you sure you want to permanently delete &quot;{form.name}&quot;? This action cannot
            be undone.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
