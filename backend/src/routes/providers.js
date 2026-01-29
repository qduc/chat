import { Router } from 'express';
import fetchLib from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../env.js';
import {
  listProviders,
  getProviderById,
  getProviderByIdWithApiKey,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
  getDefaultProvider,
} from '../db/providers.js';
import { ProviderModelsError } from '../lib/providers/baseProvider.js';
import { createProviderWithSettings, selectProviderConstructor } from '../lib/providers/index.js';
import { filterModels } from '../lib/modelFilter.js';
import { fetchAllModelsForUser as fetchAllModelsForUserShared } from '../lib/modelFetch.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  getCachedModels,
  setCachedModels,
  clearUserCache,
  isRefreshing,
  setRefreshLock,
} from '../lib/modelCache.js';
import { logger } from '../logger.js';

/**
 * Get default base URL for a provider type
 * @param {string} providerType - The provider type (openai, anthropic, etc.)
 * @returns {string} The default base URL
 */
function getDefaultBaseUrl(providerType) {
  const ProviderClass = selectProviderConstructor(providerType);
  return ProviderClass.defaultBaseUrl || 'https://api.openai.com';
}

function normalizeProviderType(providerType) {
  return (providerType || 'openai').toLowerCase();
}

function normalizeBaseUrlInput(baseUrl, providerType) {
  const fallback = getDefaultBaseUrl(providerType);
  const value = baseUrl ?? fallback;
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/$/, '').replace(/\/v1\/?$/, '');
}

function ensurePlainObject(value, fallback = {}) {
  if (!value) return { ...fallback };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed };
      }
      return { ...fallback };
    } catch {
      return { ...fallback };
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }
  return { ...fallback };
}

const PROVIDER_ERROR_MESSAGES = {
  list: {
    401: 'Invalid API key. Please check your credentials.',
    403: 'API key does not have permission to access models.',
    404: 'Invalid base URL. The /v1/models endpoint was not found.',
    500: 'Server error from the provider. Please try again later.',
  },
  testNew: {
    401: 'Invalid API key. Please check your credentials.',
    403: 'API key does not have permission to access this endpoint.',
    404: 'Invalid base URL. The /v1/models endpoint was not found.',
    500: 'Server error from the provider. Please try again later.',
  },
  testExisting: {
    401: 'Invalid API key. Please update your credentials.',
    403: 'API key does not have permission to access this endpoint.',
    404: 'Invalid base URL. The /v1/models endpoint was not found.',
    500: 'Server error from the provider. Please try again later.',
  },
};

function mapProviderStatusToMessage(status, context) {
  if (!status) return 'Failed to fetch models';
  const mapping = PROVIDER_ERROR_MESSAGES[context] || PROVIDER_ERROR_MESSAGES.list;
  if (status === 401) return mapping[401];
  if (status === 403) return mapping[403];
  if (status === 404) return mapping[404];
  if (status >= 500) return mapping[500];
  return `Provider returned error: ${status}`;
}

function truncateDetail(detail) {
  if (!detail) return '';
  return String(detail).slice(0, 200);
}

function buildProviderInstance(providerType, settings, http) {
  return createProviderWithSettings(
    config,
    providerType,
    {
      apiKey: settings.apiKey ?? null,
      baseUrl: settings.baseUrl,
      headers: settings.headers || {},
    },
    { http }
  );
}

export function createProvidersRouter({ http = globalThis.fetch ?? fetchLib } = {}) {
  const providersRouter = Router();

  // Base path: /v1/providers
  // Require authentication for all provider routes
  providersRouter.use(authenticateToken);

  providersRouter.get('/v1/providers', (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const rows = listProviders(userId);
      res.json({ providers: rows });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // Get the effective default provider for the current user
  providersRouter.get('/v1/providers/default', (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const defaultProvider = getDefaultProvider(userId);
      if (!defaultProvider) {
        return res.status(404).json({ error: 'not_found', message: 'No default provider configured' });
      }
      res.json(defaultProvider);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  providersRouter.get('/v1/providers/:id', (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const row = getProviderById(req.params.id, userId);
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  providersRouter.post('/v1/providers', (req, res) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const provider_type = String(body.provider_type || '').trim();
      if (!name || !provider_type) {
        return res.status(400).json({ error: 'invalid_request', message: 'name and provider_type are required' });
      }
      const id = body.id ? String(body.id) : uuidv4();
      const userId = req.user.id; // Guaranteed by authenticateToken middleware

      // If Gemini or Anthropic, ensure base_url is null (use default)
      let baseUrl = body.base_url ?? null;
      const normalizedType = normalizeProviderType(provider_type);
      if (normalizedType === 'gemini' || normalizedType === 'anthropic') {
        baseUrl = null;
      }

      const created = createProvider({
        id,
        name,
        provider_type,
        api_key: body.api_key ?? null,
        base_url: baseUrl,
        enabled: body.enabled !== undefined ? !!body.enabled : true,
        is_default: !!body.is_default,
        extra_headers: typeof body.extra_headers === 'object' && body.extra_headers !== null ? body.extra_headers : {},
        metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {},
        user_id: userId, // Set user ownership
      });

      // Invalidate model cache for this user
      clearUserCache(userId);

      res.status(201).json(created);
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'conflict', message: 'Provider with same id or name exists' });
      }
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  providersRouter.put('/v1/providers/:id', (req, res) => {
    try {
      const body = req.body || {};
      const userId = req.user.id; // Guaranteed by authenticateToken middleware

      // If switching to Gemini or Anthropic, force base_url to null to use defaults
      // This prevents stale base_url from OpenAI configuration persisting
      let baseUrl = body.base_url;
      if (body.provider_type) {
        const type = normalizeProviderType(body.provider_type);
        if (type === 'gemini' || type === 'anthropic') {
          baseUrl = null;
        }
      }

      const updated = updateProvider(
        req.params.id,
        {
          name: body.name,
          provider_type: body.provider_type,
          api_key: body.api_key,
          base_url: baseUrl,
          enabled: body.enabled,
          is_default: body.is_default,
          extra_headers: body.extra_headers,
          metadata: body.metadata,
        },
        userId
      );
      if (!updated) return res.status(404).json({ error: 'not_found' });

      // Invalidate model cache for this user
      clearUserCache(userId);

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  providersRouter.post('/v1/providers/:id/default', (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const row = setDefaultProvider(req.params.id, userId);
      if (!row) return res.status(404).json({ error: 'not_found' });

      // Invalidate model cache for this user
      clearUserCache(userId);

      res.json(row);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  providersRouter.delete('/v1/providers/:id', (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const ok = deleteProvider(req.params.id, userId);
      if (!ok) return res.status(404).json({ error: 'not_found' });

      // Invalidate model cache for this user
      clearUserCache(userId);

      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // List models via provider's API (server-side to avoid exposing keys)
  providersRouter.get('/v1/providers/:id/models', async (req, res) => {
    try {
      const userId = req.user.id; // Guaranteed by authenticateToken middleware
      const row = getProviderByIdWithApiKey(req.params.id, userId);
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (row.enabled === 0) {
        return res.status(400).json({ error: 'disabled', message: 'Provider is disabled' });
      }

      const providerType = normalizeProviderType(row.provider_type);
      const baseUrl = normalizeBaseUrlInput(row.base_url, providerType);
      if (!baseUrl) {
        return res.status(400).json({ error: 'invalid_provider', message: 'Missing base_url' });
      }

      const headers = ensurePlainObject(row.extra_headers);
      const provider = buildProviderInstance(providerType, { apiKey: row.api_key, baseUrl, headers }, http);

      let models = await provider.listModels({ timeoutMs: config.providerConfig.modelFetchTimeoutMs });

      const metadata = ensurePlainObject(row.metadata);
      if (metadata.model_filter) {
        models = filterModels(models, metadata.model_filter);
      }

      res.json({ provider: { id: row.id, name: row.name, provider_type: row.provider_type }, models });
    } catch (err) {
      if (err instanceof ProviderModelsError) {
        return res.status(502).json({
          error: 'bad_gateway',
          message: mapProviderStatusToMessage(err.status, 'list'),
          detail: truncateDetail(err.body),
        });
      }

      let errorMessage = 'Failed to retrieve models. Please check your provider configuration.';
      let statusCode = 502; // Default to bad gateway for provider connectivity issues

      if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        errorMessage = 'Connection timeout. Please check your base URL and network connection.';
      } else if (
        err.code === 'ENOTFOUND' ||
        err.code === 'ECONNREFUSED' ||
        err.message?.includes('ENOTFOUND') ||
        err.message?.includes('fetch failed')
      ) {
        errorMessage = 'Cannot connect to the provider. Please check your base URL.';
      } else if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
        errorMessage = 'Connection to provider was interrupted. Please try again.';
      } else if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        errorMessage = 'Network error occurred while connecting to provider.';
      } else {
        statusCode = 500;
        errorMessage = 'Internal server error while fetching models.';
      }

      res.status(statusCode).json({
        error: statusCode === 500 ? 'internal_server_error' : 'provider_error',
        message: errorMessage,
        detail: err?.message || 'Unknown error',
      });
    }
  });

  // Test provider connection without saving
  providersRouter.post('/v1/providers/test', async (req, res) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const providerTypeInput = String(body.provider_type || '').trim();

      if (!name || !providerTypeInput) {
        return res.status(400).json({ error: 'invalid_request', message: 'name and provider_type are required' });
      }
      const provider_type = normalizeProviderType(providerTypeInput);

      const api_key = body.api_key || null;
      const base_url = normalizeBaseUrlInput(body.base_url, provider_type);
      const extraHeaders = ensurePlainObject(body.extra_headers);
      const provider = buildProviderInstance(
        provider_type,
        { apiKey: api_key, baseUrl: base_url, headers: extraHeaders },
        http
      );

      let models = await provider.listModels({ timeoutMs: config.providerConfig.timeoutMs });

      const metadata = ensurePlainObject(body.metadata);
      if (metadata.model_filter) {
        models = filterModels(models, metadata.model_filter);
      }

      const modelCount = models.length;
      const sampleModels = models
        .slice(0, 3)
        .map((m) => m.id)
        .join(', ');

      res.json({
        success: true,
        message: `Connection successful! Found ${modelCount} models${sampleModels ? ` (${sampleModels}${modelCount > 3 ? ', ...' : ''})` : ''}.`,
        models: modelCount,
      });
    } catch (err) {
      if (err instanceof ProviderModelsError) {
        return res.status(400).json({
          error: 'test_failed',
          message: mapProviderStatusToMessage(err.status, 'testNew'),
          detail: truncateDetail(err.body),
        });
      }

      let errorMessage = 'Connection test failed. Please check your configuration.';

      if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timeout. Please check your base URL and network connection.';
      } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        errorMessage = 'Cannot connect to the provider. Please check your base URL.';
      }

      res.status(400).json({
        error: 'test_failed',
        message: errorMessage,
        detail: err?.message || 'Unknown error',
      });
    }
  });

  // Test existing provider connection using stored credentials but with updated config
  providersRouter.post('/v1/providers/:id/test', async (req, res) => {
    try {
      const providerId = req.params.id;
      const body = req.body || {};
      const userId = req.user.id; // Guaranteed by authenticateToken middleware

      // Get the existing provider with API key (with user scoping)
      const existingProvider = getProviderByIdWithApiKey(providerId, userId);
      if (!existingProvider) {
        return res.status(404).json({ error: 'not_found', message: 'Provider not found' });
      }

      if (!existingProvider.api_key) {
        return res.status(400).json({ error: 'invalid_provider', message: 'Provider has no API key stored' });
      }

      const providerType = normalizeProviderType(existingProvider.provider_type);
      const baseUrlInput = body.base_url !== undefined ? body.base_url : existingProvider.base_url;
      const baseUrl = normalizeBaseUrlInput(baseUrlInput, providerType);
      const headers = {
        ...ensurePlainObject(existingProvider.extra_headers),
        ...ensurePlainObject(body.extra_headers),
      };

      const provider = buildProviderInstance(
        providerType,
        { apiKey: existingProvider.api_key, baseUrl, headers },
        http
      );

      let models = await provider.listModels({ timeoutMs: config.providerConfig.timeoutMs });

      const metadata = ensurePlainObject(body.metadata);
      if (metadata.model_filter) {
        models = filterModels(models, metadata.model_filter);
      }

      const modelCount = models.length;
      const sampleModels = models
        .slice(0, 3)
        .map((m) => m.id)
        .join(', ');

      res.json({
        success: true,
        message: `Connection successful! Found ${modelCount} models${sampleModels ? ` (${sampleModels}${modelCount > 3 ? ', ...' : ''})` : ''}.`,
        models: modelCount,
      });
    } catch (err) {
      if (err instanceof ProviderModelsError) {
        return res.status(400).json({
          error: 'test_failed',
          message: mapProviderStatusToMessage(err.status, 'testExisting'),
          detail: truncateDetail(err.body),
        });
      }

      let errorMessage = 'Connection test failed. Please check your configuration.';

      if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timeout. Please check your base URL and network connection.';
      } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        errorMessage = 'Cannot connect to the provider. Please check your base URL.';
      }

      res.status(400).json({
        error: 'test_failed',
        message: errorMessage,
        detail: err?.message || 'Unknown error',
      });
    }
  });

  // Batch fetch all models from all enabled providers
  providersRouter.get('/v1/models', async (req, res) => {
    try {
      const userId = req.user.id;
      const forceRefresh = req.query.refresh === 'true';

      // Return cached unless force refresh
      if (!forceRefresh) {
        const cached = getCachedModels(userId);
        if (cached) {
          return res.json({
            providers: cached.providers,
            cached: true,
            cachedAt: new Date(cached.cachedAt).toISOString(),
          });
        }
      }

      // Prevent concurrent refreshes for the same user
      if (isRefreshing(userId)) {
        const cached = getCachedModels(userId);
        if (cached) {
          return res.json({
            providers: cached.providers,
            cached: true,
            cachedAt: new Date(cached.cachedAt).toISOString(),
            refreshing: true,
          });
        }
        return res.status(503).json({
          error: 'refresh_in_progress',
          message: 'Model refresh is in progress, please try again shortly',
        });
      }

      // Fetch fresh data from all providers
      setRefreshLock(userId, true);
      try {
        const result = await fetchAllModelsForUserShared(userId, { http, parallel: true });
        setCachedModels(userId, result.providers);

        return res.json({
          providers: result.providers,
          cached: false,
          cachedAt: new Date().toISOString(),
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      } finally {
        setRefreshLock(userId, false);
      }
    } catch (err) {
      logger.error({ msg: 'models:batch_fetch_error', err: err.message });
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  return providersRouter;
}

// Backwards-compatible default router export
export const providersRouter = createProvidersRouter();

