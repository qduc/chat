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
import { filterModels } from '../lib/modelFilter.js';
import { authenticateToken } from '../middleware/auth.js';

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

      const created = createProvider({
        id,
        name,
        provider_type,
        api_key: body.api_key ?? null,
        base_url: body.base_url ?? null,
        enabled: body.enabled !== undefined ? !!body.enabled : true,
        is_default: !!body.is_default,
        extra_headers: typeof body.extra_headers === 'object' && body.extra_headers !== null ? body.extra_headers : {},
        metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {},
        user_id: userId, // Set user ownership
      });
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

      const updated = updateProvider(req.params.id, {
        name: body.name,
        provider_type: body.provider_type,
        api_key: body.api_key,
        base_url: body.base_url,
        enabled: body.enabled,
        is_default: body.is_default,
        extra_headers: body.extra_headers,
        metadata: body.metadata,
      }, userId);
      if (!updated) return res.status(404).json({ error: 'not_found' });
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
      if (row.enabled === 0) return res.status(400).json({ error: 'disabled', message: 'Provider is disabled' });

      const baseUrl = String(row.base_url || '').replace(/\/v1\/?$/, '');
      if (!baseUrl) return res.status(400).json({ error: 'invalid_provider', message: 'Missing base_url' });

    let extra = {};
    try {
      extra = row.extra_headers ? JSON.parse(row.extra_headers) : {};
    } catch {
      extra = {};
    }

    const url = `${baseUrl}/v1/models`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${row.api_key}`,
      ...extra,
    };

    const upstream = await http(url, {
      method: 'GET',
      headers,
      timeout: config.providerConfig.modelFetchTimeoutMs
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      let errorMessage = 'Failed to fetch models';

      if (upstream.status === 401) {
        errorMessage = 'Invalid API key. Please check your credentials.';
      } else if (upstream.status === 403) {
        errorMessage = 'API key does not have permission to access models.';
      } else if (upstream.status === 404) {
        errorMessage = 'Invalid base URL. The /v1/models endpoint was not found.';
      } else if (upstream.status >= 500) {
        errorMessage = 'Server error from the provider. Please try again later.';
      } else {
        errorMessage = `Provider returned error: ${upstream.status}`;
      }

      return res.status(502).json({
        error: 'bad_gateway',
        message: errorMessage,
        detail: text.slice(0, 200)
      });
    }

    const json = await upstream.json().catch(() => ({}));
    let models = [];
    if (Array.isArray(json?.data)) models = json.data;
    else if (Array.isArray(json?.models)) models = json.models;
    else if (Array.isArray(json)) models = json;

    // Normalize to { id, ... }
    models = models
      .map((m) => (typeof m === 'string' ? { id: m } : m))
      .filter((m) => m && m.id);

    // Filter OpenRouter models to only show those released in the last 1 year
    if (baseUrl.includes('openrouter.ai')) {
      const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
      models = models.filter((m) => {
        // If no 'created' field, include the model (backwards compatibility)
        if (!m.created) return true;
        // Filter out models older than 1 year
        return m.created >= oneYearAgo;
      });
    }

    // Apply model filter from provider metadata if configured
    // Note: row.metadata is already parsed by getProviderByIdWithApiKey
    if (row.metadata && row.metadata.model_filter) {
      models = filterModels(models, row.metadata.model_filter);
    }

    res.json({ provider: { id: row.id, name: row.name, provider_type: row.provider_type }, models });
  } catch (err) {
    let errorMessage = 'Failed to retrieve models. Please check your provider configuration.';
    let statusCode = 502; // Default to bad gateway for provider connectivity issues

    // Check various error conditions for network-related issues
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
      errorMessage = 'Connection timeout. Please check your base URL and network connection.';
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.message?.includes('ENOTFOUND') || err.message?.includes('fetch failed')) {
      errorMessage = 'Cannot connect to the provider. Please check your base URL.';
    } else if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
      errorMessage = 'Connection to provider was interrupted. Please try again.';
    } else if (err.name === 'TypeError' && err.message?.includes('fetch')) {
      errorMessage = 'Network error occurred while connecting to provider.';
    } else {
      // For truly internal errors (database issues, etc.), use 500
      statusCode = 500;
      errorMessage = 'Internal server error while fetching models.';
    }

    res.status(statusCode).json({
      error: statusCode === 500 ? 'internal_server_error' : 'provider_error',
      message: errorMessage,
      detail: err?.message || 'Unknown error'
    });
  }
  });

// Test provider connection without saving
  providersRouter.post('/v1/providers/test', async (req, res) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const provider_type = String(body.provider_type || '').trim();

      if (!name || !provider_type) {
        return res.status(400).json({ error: 'invalid_request', message: 'name and provider_type are required' });
      }

    const api_key = body.api_key || null;
    const base_url = String(body.base_url || '').replace(/\/v1\/?$/, '') || 'https://api.openai.com';

    let extra = {};
    try {
      extra = body.extra_headers ? JSON.parse(body.extra_headers) : {};
    } catch {
      extra = {};
    }

    // Test connection by attempting to list models
    const url = `${base_url}/v1/models`;
    const headers = {
      Accept: 'application/json',
      ...extra,
    };
    if (api_key) {
      headers.Authorization = `Bearer ${api_key}`;
    }

    const upstream = await http(url, {
      method: 'GET',
      headers,
      timeout: config.providerConfig.timeoutMs
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      let errorMessage = 'Connection failed';

      if (upstream.status === 401) {
        errorMessage = 'Invalid API key. Please check your credentials.';
      } else if (upstream.status === 403) {
        errorMessage = 'API key does not have permission to access this endpoint.';
      } else if (upstream.status === 404) {
        errorMessage = 'Invalid base URL. The /v1/models endpoint was not found.';
      } else if (upstream.status >= 500) {
        errorMessage = 'Server error from the provider. Please try again later.';
      } else {
        errorMessage = `Provider returned error: ${upstream.status}`;
      }

      return res.status(400).json({
        error: 'test_failed',
        message: errorMessage,
        detail: text.slice(0, 200)
      });
    }

    const json = await upstream.json().catch(() => ({}));
    let models = [];
    if (Array.isArray(json?.data)) models = json.data;
    else if (Array.isArray(json?.models)) models = json.models;
    else if (Array.isArray(json)) models = json;

    models = models
      .map((m) => (typeof m === 'string' ? { id: m } : m))
      .filter((m) => m && m.id);

    // Filter OpenRouter models to only show those released in the last 1 year
    if (base_url.includes('openrouter.ai')) {
      const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
      models = models.filter((m) => {
        // If no 'created' field, include the model (backwards compatibility)
        if (!m.created) return true;
        // Filter out models older than 1 year
        return m.created >= oneYearAgo;
      });
    }

    // Apply model filter from metadata if configured
    if (body.metadata && body.metadata.model_filter) {
      models = filterModels(models, body.metadata.model_filter);
    }

    const modelCount = models.length;
    const sampleModels = models.slice(0, 3).map(m => m.id).join(', ');

    res.json({
      success: true,
      message: `Connection successful! Found ${modelCount} models${sampleModels ? ` (${sampleModels}${modelCount > 3 ? ', ...' : ''})` : ''}.`,
      models: modelCount
    });
  } catch (err) {
    let errorMessage = 'Connection test failed. Please check your configuration.';

    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timeout. Please check your base URL and network connection.';
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to the provider. Please check your base URL.';
    }

    res.status(400).json({
      error: 'test_failed',
      message: errorMessage,
      detail: err?.message || 'Unknown error'
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

    // Use existing API key but allow override of other settings for testing
    const base_url = (body.base_url !== undefined ? body.base_url : existingProvider.base_url) || 'https://api.openai.com';

    const testBaseUrl = String(base_url).replace(/\/v1\/?$/, '');

    let extra = {};
    try {
      extra = existingProvider.extra_headers ? JSON.parse(existingProvider.extra_headers) : {};
      if (body.extra_headers && typeof body.extra_headers === 'object') {
        extra = { ...extra, ...body.extra_headers };
      }
    } catch {
      extra = {};
    }

    // Test connection by attempting to list models
    const url = `${testBaseUrl}/v1/models`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${existingProvider.api_key}`,
      ...extra,
    };

    const upstream = await http(url, {
      method: 'GET',
      headers,
      timeout: config.providerConfig.timeoutMs
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      let errorMessage = 'Connection failed';

      if (upstream.status === 401) {
        errorMessage = 'Invalid API key. Please update your credentials.';
      } else if (upstream.status === 403) {
        errorMessage = 'API key does not have permission to access this endpoint.';
      } else if (upstream.status === 404) {
        errorMessage = 'Invalid base URL. The /v1/models endpoint was not found.';
      } else if (upstream.status >= 500) {
        errorMessage = 'Server error from the provider. Please try again later.';
      } else {
        errorMessage = `Provider returned error: ${upstream.status}`;
      }

      return res.status(400).json({
        error: 'test_failed',
        message: errorMessage,
        detail: text.slice(0, 200)
      });
    }

    const json = await upstream.json().catch(() => ({}));
    let models = [];
    if (Array.isArray(json?.data)) models = json.data;
    else if (Array.isArray(json?.models)) models = json.models;
    else if (Array.isArray(json)) models = json;

    models = models
      .map((m) => (typeof m === 'string' ? { id: m } : m))
      .filter((m) => m && m.id);

    // Filter OpenRouter models to only show those released in the last 1 year
    if (testBaseUrl.includes('openrouter.ai')) {
      const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
      models = models.filter((m) => {
        // If no 'created' field, include the model (backwards compatibility)
        if (!m.created) return true;
        // Filter out models older than 1 year
        return m.created >= oneYearAgo;
      });
    }

    // Apply model filter from metadata if configured
    if (body.metadata && body.metadata.model_filter) {
      models = filterModels(models, body.metadata.model_filter);
    }

    const modelCount = models.length;
    const sampleModels = models.slice(0, 3).map(m => m.id).join(', ');

    res.json({
      success: true,
      message: `Connection successful! Found ${modelCount} models${sampleModels ? ` (${sampleModels}${modelCount > 3 ? ', ...' : ''})` : ''}.`,
      models: modelCount
    });
  } catch (err) {
    let errorMessage = 'Connection test failed. Please check your configuration.';

    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timeout. Please check your base URL and network connection.';
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to the provider. Please check your base URL.';
    }

    res.status(400).json({
      error: 'test_failed',
      message: errorMessage,
      detail: err?.message || 'Unknown error'
    });
  }
  });

  return providersRouter;
}

// Backwards-compatible default router export
export const providersRouter = createProvidersRouter();

