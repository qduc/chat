'use client';

import React from 'react';
import SearchEngineCard from '../ui/SearchEngineCard';
import { httpClient } from '../../lib';
import { useToast } from '../ui/Toast';

interface SearchTabProps {
  isVisible: boolean;
  isOpen: boolean;
}

type SearchEngine = 'tavily' | 'exa' | 'searxng' | 'firecrawl';

export default function SearchTab({ isVisible, isOpen }: SearchTabProps) {
  const { showToast } = useToast();

  const [searchApiKeys, setSearchApiKeys] = React.useState<Record<SearchEngine, string>>({
    tavily: '',
    exa: '',
    searxng: '',
    firecrawl: '',
  });

  const [searchSaving, setSearchSaving] = React.useState<Record<SearchEngine, boolean>>({
    tavily: false,
    exa: false,
    searxng: false,
    firecrawl: false,
  });

  const [searchErrors, setSearchErrors] = React.useState<Record<SearchEngine, string | null>>({
    tavily: null,
    exa: null,
    searxng: null,
    firecrawl: null,
  });

  const [searxBaseUrl, setSearxBaseUrl] = React.useState('');
  const [searxBaseUrlError, setSearxBaseUrlError] = React.useState<string | null>(null);

  const [firecrawlBaseUrl, setFirecrawlBaseUrl] = React.useState('');
  const [firecrawlBaseUrlError, setFirecrawlBaseUrlError] = React.useState<string | null>(null);

  const [searchReveal, setSearchReveal] = React.useState<Record<SearchEngine, boolean>>({
    tavily: false,
    exa: false,
    searxng: false,
    firecrawl: false,
  });

  const [initialSearchApiKeys, setInitialSearchApiKeys] = React.useState<
    Record<SearchEngine, string>
  >({
    tavily: '',
    exa: '',
    searxng: '',
    firecrawl: '',
  });

  const [initialSearxBaseUrl, setInitialSearxBaseUrl] = React.useState('');
  const [initialFirecrawlBaseUrl, setInitialFirecrawlBaseUrl] = React.useState('');
  const [expandedSearchEngine, setExpandedSearchEngine] = React.useState<SearchEngine | null>(null);

  // Fetch user settings
  React.useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await httpClient.get('/v1/user-settings');
        const keys = res.data || {};
        const loadedKeys = {
          tavily: keys.tavily_api_key || '',
          exa: keys.exa_api_key || '',
          searxng: keys.searxng_api_key || '',
          firecrawl: keys.firecrawl_api_key || '',
        };
        setSearchApiKeys(loadedKeys);
        setInitialSearchApiKeys(loadedKeys);
        setSearchErrors({ tavily: null, exa: null, searxng: null, firecrawl: null });

        const loadedBaseUrl = keys.searxng_base_url || '';
        setSearxBaseUrl(loadedBaseUrl);
        setInitialSearxBaseUrl(loadedBaseUrl);
        setSearxBaseUrlError(null);

        const loadedFirecrawlBaseUrl = keys.firecrawl_base_url || '';
        setFirecrawlBaseUrl(loadedFirecrawlBaseUrl);
        setInitialFirecrawlBaseUrl(loadedFirecrawlBaseUrl);
        setFirecrawlBaseUrlError(null);
      } catch (err: any) {
        setSearchErrors({
          tavily: err?.message || 'Failed to load Tavily API key',
          exa: err?.message || 'Failed to load Exa API key',
          searxng: err?.message || 'Failed to load SearXNG API key',
          firecrawl: err?.message || 'Failed to load Firecrawl API key',
        });
        setSearxBaseUrlError(err?.message || 'Failed to load SearXNG base URL');
        setFirecrawlBaseUrlError(err?.message || 'Failed to load Firecrawl base URL');
      }
    })();
  }, [isOpen]);

  return (
    <div className={isVisible ? 'space-y-4' : 'hidden'}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Search Engines API Keys
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Store API keys to enable third-party web search tools. Keys are encrypted and scoped to
            your account.
          </p>
        </div>
      </div>

      {/* Search engines list */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 shadow-sm divide-y divide-zinc-200/70 dark:divide-zinc-800">
        <SearchEngineCard
          name="SearXNG"
          description="Self-hosted metasearch engine"
          docsUrl="https://github.com/searxng/searxng"
          apiKeyField={{
            label: 'API Key',
            placeholder: 'Optional authentication key',
            helperText: 'Encrypted and stored securely with your account',
            value: searchApiKeys.searxng,
            error: searchErrors.searxng || undefined,
            onChange: (value) => {
              setSearchApiKeys((prev) => ({ ...prev, searxng: value }));
              setSearchErrors((prev) => ({ ...prev, searxng: null }));
            },
          }}
          baseUrlField={{
            label: 'Base URL',
            placeholder: 'https://searx.example/search',
            helperText: 'Leave empty to use legacy configuration',
            value: searxBaseUrl,
            error: searxBaseUrlError || undefined,
            onChange: (value) => {
              setSearxBaseUrl(value);
              setSearxBaseUrlError(null);
            },
            type: 'url',
          }}
          isRevealed={searchReveal.searxng}
          onRevealToggle={() => setSearchReveal((prev) => ({ ...prev, searxng: !prev.searxng }))}
          isSaving={searchSaving.searxng}
          onSave={async () => {
            setSearchSaving((prev) => ({ ...prev, searxng: true }));
            setSearchErrors((prev) => ({ ...prev, searxng: null }));
            try {
              if (searchApiKeys.searxng && searchApiKeys.searxng.trim() !== '') {
                await httpClient.put('/v1/user-settings', {
                  searxng_api_key: searchApiKeys.searxng.trim(),
                });
                setInitialSearchApiKeys((prev) => ({
                  ...prev,
                  searxng: searchApiKeys.searxng,
                }));
              } else {
                setSearchErrors((prev) => ({
                  ...prev,
                  searxng: 'Please enter a valid API key to save',
                }));
              }
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
              showToast({
                message: 'SearXNG settings saved successfully!',
                variant: 'success',
              });
            } catch (err: any) {
              setSearchErrors((prev) => ({
                ...prev,
                searxng: err?.message || 'Failed to save settings',
              }));
            } finally {
              setSearchSaving((prev) => ({ ...prev, searxng: false }));
            }
          }}
          hasChanges={
            searxBaseUrl !== initialSearxBaseUrl ||
            searchApiKeys.searxng !== initialSearchApiKeys.searxng
          }
          isExpanded={expandedSearchEngine === 'searxng'}
          onToggleExpand={() =>
            setExpandedSearchEngine(expandedSearchEngine === 'searxng' ? null : 'searxng')
          }
        />

        <SearchEngineCard
          name="Firecrawl"
          description="Turn websites into LLM-ready data"
          docsUrl="https://firecrawl.dev"
          apiKeyField={{
            label: 'API Key',
            placeholder: 'Required for cloud, optional for self-hosted',
            helperText: 'Encrypted and stored securely with your account',
            value: searchApiKeys.firecrawl,
            error: searchErrors.firecrawl || undefined,
            onChange: (value) => {
              setSearchApiKeys((prev) => ({ ...prev, firecrawl: value }));
              setSearchErrors((prev) => ({ ...prev, firecrawl: null }));
            },
          }}
          baseUrlField={{
            label: 'Base URL',
            placeholder: 'https://api.firecrawl.dev (or self-hosted URL)',
            helperText: 'Leave empty to use default cloud API (https://api.firecrawl.dev)',
            value: firecrawlBaseUrl,
            error: firecrawlBaseUrlError || undefined,
            onChange: (value) => {
              setFirecrawlBaseUrl(value);
              setFirecrawlBaseUrlError(null);
            },
            type: 'url',
          }}
          isRevealed={searchReveal.firecrawl}
          onRevealToggle={() =>
            setSearchReveal((prev) => ({ ...prev, firecrawl: !prev.firecrawl }))
          }
          isSaving={searchSaving.firecrawl}
          onSave={async () => {
            setSearchSaving((prev) => ({ ...prev, firecrawl: true }));
            setSearchErrors((prev) => ({ ...prev, firecrawl: null }));
            try {
              if (searchApiKeys.firecrawl && searchApiKeys.firecrawl.trim() !== '') {
                await httpClient.put('/v1/user-settings', {
                  firecrawl_api_key: searchApiKeys.firecrawl.trim(),
                });
                setInitialSearchApiKeys((prev) => ({
                  ...prev,
                  firecrawl: searchApiKeys.firecrawl,
                }));
              } else {
                await httpClient.put('/v1/user-settings', {
                  firecrawl_api_key: '',
                });
                setInitialSearchApiKeys((prev) => ({
                  ...prev,
                  firecrawl: '',
                }));
              }
              const trimmedValue = firecrawlBaseUrl.trim();
              if (trimmedValue && !/^https?:\/\//i.test(trimmedValue)) {
                throw new Error(
                  'Please enter a valid Firecrawl base URL starting with http:// or https://'
                );
              }
              await httpClient.put('/v1/user-settings', {
                firecrawl_base_url: trimmedValue || null,
              });
              setInitialFirecrawlBaseUrl(trimmedValue);
              showToast({
                message: 'Firecrawl settings saved successfully!',
                variant: 'success',
              });
            } catch (err: any) {
              setSearchErrors((prev) => ({
                ...prev,
                firecrawl: err?.message || 'Failed to save settings',
              }));
            } finally {
              setSearchSaving((prev) => ({ ...prev, firecrawl: false }));
            }
          }}
          hasChanges={
            firecrawlBaseUrl !== initialFirecrawlBaseUrl ||
            searchApiKeys.firecrawl !== initialSearchApiKeys.firecrawl
          }
          isExpanded={expandedSearchEngine === 'firecrawl'}
          onToggleExpand={() =>
            setExpandedSearchEngine(expandedSearchEngine === 'firecrawl' ? null : 'firecrawl')
          }
        />

        <SearchEngineCard
          name="Tavily"
          description="Real-time web search API"
          docsUrl="https://tavily.com"
          apiKeyField={{
            label: 'API Key',
            placeholder: 'Paste your Tavily API key here',
            helperText: 'Encrypted and stored securely with your account',
            value: searchApiKeys.tavily,
            error: searchErrors.tavily || undefined,
            onChange: (value) => {
              setSearchApiKeys((prev) => ({ ...prev, tavily: value }));
              setSearchErrors((prev) => ({ ...prev, tavily: null }));
            },
          }}
          isRevealed={searchReveal.tavily}
          onRevealToggle={() => setSearchReveal((prev) => ({ ...prev, tavily: !prev.tavily }))}
          isSaving={searchSaving.tavily}
          onSave={async () => {
            setSearchSaving((prev) => ({ ...prev, tavily: true }));
            setSearchErrors((prev) => ({ ...prev, tavily: null }));
            try {
              if (searchApiKeys.tavily && searchApiKeys.tavily.trim() !== '') {
                await httpClient.put('/v1/user-settings', {
                  tavily_api_key: searchApiKeys.tavily.trim(),
                });
                setInitialSearchApiKeys((prev) => ({
                  ...prev,
                  tavily: searchApiKeys.tavily,
                }));
                showToast({
                  message: 'Tavily API key saved successfully!',
                  variant: 'success',
                });
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
          hasChanges={searchApiKeys.tavily !== initialSearchApiKeys.tavily}
          isExpanded={expandedSearchEngine === 'tavily'}
          onToggleExpand={() =>
            setExpandedSearchEngine(expandedSearchEngine === 'tavily' ? null : 'tavily')
          }
        />

        <SearchEngineCard
          name="Exa"
          description="Neural search for the web"
          docsUrl="https://exa.ai"
          apiKeyField={{
            label: 'API Key',
            placeholder: 'Paste your Exa API key here',
            helperText: 'Encrypted and stored securely with your account',
            value: searchApiKeys.exa,
            error: searchErrors.exa || undefined,
            onChange: (value) => {
              setSearchApiKeys((prev) => ({ ...prev, exa: value }));
              setSearchErrors((prev) => ({ ...prev, exa: null }));
            },
          }}
          isRevealed={searchReveal.exa}
          onRevealToggle={() => setSearchReveal((prev) => ({ ...prev, exa: !prev.exa }))}
          isSaving={searchSaving.exa}
          onSave={async () => {
            setSearchSaving((prev) => ({ ...prev, exa: true }));
            setSearchErrors((prev) => ({ ...prev, exa: null }));
            try {
              if (searchApiKeys.exa && searchApiKeys.exa.trim() !== '') {
                await httpClient.put('/v1/user-settings', {
                  exa_api_key: searchApiKeys.exa.trim(),
                });
                setInitialSearchApiKeys((prev) => ({
                  ...prev,
                  exa: searchApiKeys.exa,
                }));
                showToast({
                  message: 'Exa API key saved successfully!',
                  variant: 'success',
                });
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
          hasChanges={searchApiKeys.exa !== initialSearchApiKeys.exa}
          isExpanded={expandedSearchEngine === 'exa'}
          onToggleExpand={() =>
            setExpandedSearchEngine(expandedSearchEngine === 'exa' ? null : 'exa')
          }
        />
      </div>

      <div className="bg-zinc-50/60 dark:bg-zinc-900/30 rounded-lg p-4 border border-zinc-200/30 dark:border-zinc-700/30">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Security:</strong> All
          API keys are encrypted and stored securely on the server. They are only accessible by your
          account and never shared or logged.
        </p>
      </div>
    </div>
  );
}
