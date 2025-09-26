import React from 'react';
import { Sun, Moon, Settings } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import ModelSelector from './ui/ModelSelector';
import { type Group as TabGroup } from './ui/TabbedSelect';
import { AuthButton } from './auth/AuthButton';

interface ChatHeaderProps {
  isStreaming: boolean;
  onNewChat?: () => void;
  model: string;
  onModelChange: (model: string) => void;
  onProviderChange?: (providerId: string) => void;
  onOpenSettings?: () => void;
  onShowLogin?: () => void;
  onShowRegister?: () => void;
}

export function ChatHeader({ model, onModelChange, onProviderChange, onOpenSettings, onShowLogin, onShowRegister }: ChatHeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // Derive models from configured providers with a safe fallback
  type Option = { value: string; label: string };
  const defaultOpenAIModels: Option[] = React.useMemo(() => ([
    { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' }
  ]), []);

  const apiBase = (process.env.NEXT_PUBLIC_API_BASE as string) ?? 'http://localhost:3001';
  const [modelOptions, setModelOptions] = React.useState<Option[]>(defaultOpenAIModels);
  const [groups, setGroups] = React.useState<TabGroup[] | null>(null);
  const [modelToProvider, setModelToProvider] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const res = await fetch(`${apiBase}/v1/providers`);
        if (!res.ok) return; // fallback to defaults silently
        const json = await res.json();
        const providers: any[] = Array.isArray(json.providers) ? json.providers : [];
        const enabledProviders = providers.filter(p => p?.enabled);
        if (!enabledProviders.length) return;

        // Fetch models for each provider via backend proxy endpoint
        const results = await Promise.allSettled(
          enabledProviders.map(async (p) => {
            const r = await fetch(`${apiBase}/v1/providers/${encodeURIComponent(p.id)}/models`);
            if (!r.ok) throw new Error(`models ${r.status}`);
            const j = await r.json();
            const models = Array.isArray(j.models) ? j.models : [];
            const options: Option[] = models.map((m: any) => ({ value: m.id, label: m.id }));
            return { provider: p, options };
          })
        );

        // Build groups and model-to-provider mapping; include only providers with at least one model
        const gs: TabGroup[] = [];
        const modelProviderMap = new Map<string, string>();

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled' && r.value.options.length > 0) {
            const providerId = r.value.provider.id;
            gs.push({ id: providerId, label: r.value.provider.name || providerId, options: r.value.options });

            // Map each model to its provider
            r.value.options.forEach((option: Option) => {
              modelProviderMap.set(option.value, providerId);
            });
          }
        }

        // Fallback: if no models returned, keep OpenAI defaults as a single group
        if (gs.length === 0) {
          if (!cancelled) {
            setGroups([{ id: 'default', label: 'Models', options: defaultOpenAIModels }]);
            const fallbackMap = new Map<string, string>();
            defaultOpenAIModels.forEach(option => {
              fallbackMap.set(option.value, 'default');
            });
            setModelToProvider(fallbackMap);
            if (!defaultOpenAIModels.some(o => o.value === model)) {
              onModelChange(defaultOpenAIModels[0].value);
            }
          }
          return;
        }

        if (!cancelled) {
          setGroups(gs);
          setModelToProvider(modelProviderMap);
          // Also flatten into options for simple fallback component rendering if needed
          const flat = gs.flatMap(g => g.options);
          setModelOptions(flat);

          // Ensure model belongs to a provider; else set to first model in that provider
          if (!flat.some(o => o.value === model)) {
            const nextModel = flat[0]?.value;
            if (nextModel) onModelChange(nextModel);
          }
        }
      } catch {
        // ignore errors; keep defaults
      }
    }

    loadProviders();
    return () => { cancelled = true; };
  }, [apiBase, defaultOpenAIModels, onModelChange, model]);

  // Notify parent when provider changes based on selected model
  React.useEffect(() => {
    const providerId = modelToProvider.get(model);
    if (providerId && onProviderChange) {
      onProviderChange(providerId);
    }
  }, [model, modelToProvider, onProviderChange]);

  const toggleTheme = () => {
    if (theme === 'dark') {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  return (
    <header className="sticky top-0 z-10 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-md">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center">
          <ModelSelector
            value={model}
            onChange={onModelChange}
            groups={groups}
            fallbackOptions={modelOptions}
            className="text-lg"
            ariaLabel="Model"
          />
        </div>

        <div className="flex items-center gap-3">
          <AuthButton onShowLogin={onShowLogin} onShowRegister={onShowRegister} />
          <button
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
            title="Open settings"
            aria-label="Open settings"
            type="button"
          >
            <Settings className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </button>
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700 flex items-center justify-center shadow-sm transition-colors"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            type="button"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
