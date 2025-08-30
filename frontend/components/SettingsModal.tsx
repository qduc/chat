"use client";
import React from 'react';
import { Gauge, Wrench, Zap, FlaskConical, Cog, Database, Plus, Save, RefreshCw, Trash2, Star } from 'lucide-react';
import Modal from './ui/Modal';
import IconSelect from './ui/IconSelect';
import Toggle from './ui/Toggle';
import QualitySlider, { type QualityLevel } from './ui/QualitySlider';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  model: string;
  onModelChange: (model: string) => void;
  useTools: boolean;
  onUseToolsChange: (v: boolean) => void;
  shouldStream: boolean;
  onShouldStreamChange: (v: boolean) => void;
  researchMode: boolean;
  onResearchModeChange: (v: boolean) => void;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
}

export default function SettingsModal({
  open,
  onClose,
  model,
  onModelChange,
  useTools,
  onUseToolsChange,
  shouldStream,
  onShouldStreamChange,
  researchMode,
  onResearchModeChange,
  qualityLevel,
  onQualityLevelChange,
}: SettingsModalProps) {
  // --- Providers management state ---
  type ProviderRow = {
    id: string;
    name: string;
    provider_type: string;
    base_url?: string | null;
    is_default?: number | boolean;
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
    is_default: boolean;
    api_key?: string;
    default_model?: string;
  }>({ name: '', provider_type: 'openai', base_url: '', enabled: true, is_default: false });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resetForm = React.useCallback(() => {
    setSelectedId(null);
    setForm({ name: '', provider_type: 'openai', base_url: '', enabled: true, is_default: false, api_key: '', default_model: '' });
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
  }, [apiBase, selectedId]);

  const populateFormFromRow = (r: ProviderRow) => {
    setForm({
      id: r.id,
      name: r.name,
      provider_type: r.provider_type,
      base_url: r.base_url || '',
      enabled: Boolean(r.enabled),
      is_default: Boolean(r.is_default),
      api_key: '', // not returned by API; allow setting new value
      default_model: (r.metadata as any)?.default_model || '',
    });
  };

  React.useEffect(() => {
    if (open) fetchProviders();
  }, [open, fetchProviders]);

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
        is_default: form.is_default,
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

  async function onSetDefault() {
    if (!form.id) return;
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`${apiBase}/v1/providers/${form.id}/default`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to set default (${res.status})`);
      await fetchProviders();
    } catch (e: any) {
      setError(e?.message || 'Failed to set default');
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteProvider(id?: string) {
    const target = id || form.id;
    if (!target) return;
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

  return (
    <Modal open={open} onClose={onClose} title={<div className="flex items-center gap-2"><Cog className="w-4 h-4" /> Settings</div> as any}>
      <div className="flex flex-col gap-4">
        {/* --- Chat settings --- */}
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-700 dark:text-slate-300">Model</div>
          <IconSelect
            ariaLabel="Model"
            value={model}
            onChange={onModelChange}
            options={[
              { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
              { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
              { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
              { value: 'gpt-4o', label: 'GPT-4o' }
            ]}
          />
        </div>

        {model?.startsWith('gpt-5') && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-slate-700 dark:text-slate-300">Response quality</div>
            <QualitySlider
              value={qualityLevel}
              onChange={onQualityLevelChange}
              icon={<Gauge className="w-4 h-4" />}
              ariaLabel="Response Quality"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <Wrench className="w-4 h-4" />
            Tools
          </div>
          <Toggle ariaLabel="Tools" checked={useTools} onChange={onUseToolsChange} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <Zap className="w-4 h-4" />
            Stream responses
          </div>
          <Toggle ariaLabel="Stream" checked={shouldStream} onChange={onShouldStreamChange} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <FlaskConical className="w-4 h-4" />
            Research mode
          </div>
          <Toggle ariaLabel="Research" checked={researchMode} onChange={onResearchModeChange} disabled={!useTools} />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500 text-white shadow-sm"
          >
            Close
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-200 dark:bg-slate-700 my-2" />

        {/* --- Providers management --- */}
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          <Database className="w-4 h-4" /> Providers
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
            onClick={fetchProviders}
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* List */}
          <div className="flex flex-col gap-2">
            <div className="text-xs text-slate-500">Existing providers</div>
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
              {loadingProviders && (
                <div className="p-3 text-xs text-slate-500">Loading…</div>
              )}
              {!loadingProviders && providers.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No providers</div>
              )}
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProvider(p)}
                  className={`w-full text-left p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between ${selectedId === p.id ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                >
                  <span className="truncate">
                    {p.name} <span className="text-xs text-slate-500">({p.provider_type})</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {p.is_default ? <span className="inline-flex items-center gap-1 text-amber-600"><Star className="w-3 h-3" /> default</span> : null}
                    {p.enabled ? <span className="text-emerald-600">enabled</span> : <span className="text-slate-500">disabled</span>}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                <Plus className="w-3 h-3" /> New
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={() => onDeleteProvider()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-600 hover:bg-red-500 text-white"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Name</label>
              <input
                className="col-span-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="OpenAI"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Type</label>
              <select
                className="col-span-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                value={form.provider_type}
                onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
              >
                <option value="openai">openai</option>
              </select>
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Base URL</label>
              <input
                className="col-span-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">API Key</label>
              <input
                className="col-span-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                value={form.api_key || ''}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                placeholder="sk-... (leave blank to keep)"
                type="password"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Default Model</label>
              <input
                className="col-span-2 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                value={form.default_model || ''}
                onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                placeholder="gpt-4.1-mini"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Enabled</label>
              <div className="col-span-2"><Toggle ariaLabel="Enabled" checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} /></div>
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">Default</label>
              <div className="col-span-2"><Toggle ariaLabel="Default" checked={form.is_default} onChange={(v) => setForm((f) => ({ ...f, is_default: v }))} /></div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onSaveProvider}
                disabled={saving || !form.name || !form.provider_type}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
              >
                <Save className="w-3 h-3" /> Save
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={onSetDefault}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-md bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  <Star className="w-3 h-3" /> Set Default
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
