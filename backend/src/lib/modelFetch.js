/**
 * Shared model fetching utilities.
 *
 * This module provides a single source of truth for fetching models from providers,
 * used by both the API routes and the background refresh worker.
 */

import { config } from '../env.js';
import { listProviders, getProviderByIdWithApiKey } from '../db/providers.js';
import { createProviderWithSettings, selectProviderConstructor } from './providers/index.js';
import { filterModels } from './modelFilter.js';
import { ProviderModelsError } from './providers/baseProvider.js';
import { logger } from '../logger.js';

/**
 * Normalize provider type to lowercase
 * @param {string} providerType
 * @returns {string}
 */
function normalizeProviderType(providerType) {
  return (providerType || 'openai').toLowerCase();
}

/**
 * Get the effective base URL for a provider, falling back to provider defaults
 * @param {string|null} dbBaseUrl - Base URL from database
 * @param {string} providerType - Provider type (openai, anthropic, gemini)
 * @returns {string} The effective base URL
 */
function getEffectiveBaseUrl(dbBaseUrl, providerType) {
  const ProviderClass = selectProviderConstructor(providerType);
  const defaultBaseUrl = ProviderClass.defaultBaseUrl || 'https://api.openai.com';

  // Use nullish coalescing - only fall back to default if dbBaseUrl is null/undefined
  // (empty string would also trigger fallback since it's falsy, but that's intentional)
  return dbBaseUrl || defaultBaseUrl;
}

/**
 * Ensure value is a plain object
 * @param {*} value
 * @param {Object} fallback
 * @returns {Object}
 */
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

/**
 * @typedef {Object} ProviderModelResult
 * @property {Object} provider - Provider info (id, name, provider_type)
 * @property {Array} models - Array of model objects
 */

/**
 * @typedef {Object} ProviderModelError
 * @property {string} providerId - Provider ID
 * @property {string} providerName - Provider name
 * @property {string} error - Error message
 */

/**
 * @typedef {Object} FetchModelsResult
 * @property {ProviderModelResult[]} providers - Successful results
 * @property {ProviderModelError[]} errors - Errors encountered
 */

/**
 * Map provider error status to user-friendly message
 * @param {number} status - HTTP status code
 * @returns {string} User-friendly error message
 */
function mapProviderStatusToMessage(status) {
  if (!status) return 'Failed to fetch models';
  if (status === 401) return 'Invalid API key. Please check your credentials.';
  if (status === 403) return 'API key does not have permission to access models.';
  if (status === 404) return 'Invalid base URL. The /v1/models endpoint was not found.';
  if (status >= 500) return 'Server error from the provider. Please try again later.';
  return `Provider returned error: ${status}`;
}

/**
 * Fetch models from a single provider
 * @param {Object} providerRow - Provider row from database (with API key)
 * @param {Object} options - Options
 * @param {Function} [options.http] - HTTP client (defaults to global fetch)
 * @param {number} [options.timeoutMs] - Timeout in milliseconds
 * @returns {Promise<ProviderModelResult>} Provider models result
 */
export async function fetchModelsFromProvider(providerRow, options = {}) {
  const { http, timeoutMs = config.providerConfig.modelFetchTimeoutMs } = options;

  const providerType = normalizeProviderType(providerRow.provider_type);
  const baseUrl = getEffectiveBaseUrl(providerRow.base_url, providerType);
  const headers = ensurePlainObject(providerRow.extra_headers);

  const providerInstance = createProviderWithSettings(
    config,
    providerType,
    {
      apiKey: providerRow.api_key,
      baseUrl,
      headers,
    },
    { http }
  );

  let models = await providerInstance.listModels({ timeoutMs });

  // Apply model filter if configured
  const metadata = ensurePlainObject(providerRow.metadata);
  if (metadata.model_filter) {
    models = filterModels(models, metadata.model_filter);
  }

  return {
    provider: {
      id: providerRow.id,
      name: providerRow.name,
      provider_type: providerRow.provider_type,
    },
    models,
  };
}

/**
 * Fetch models from all enabled providers for a user
 * @param {string} userId - User ID
 * @param {Object} options - Options
 * @param {Function} [options.http] - HTTP client (defaults to global fetch)
 * @param {boolean} [options.parallel=true] - Whether to fetch in parallel
 * @param {boolean} [options.skipMissingApiKey=false] - Whether to skip providers without API keys
 * @returns {Promise<FetchModelsResult>} Results and errors
 */
export async function fetchAllModelsForUser(userId, options = {}) {
  const { http, parallel = true, skipMissingApiKey = false } = options;

  const providers = listProviders(userId).filter((p) => p.enabled === 1);
  const results = [];
  const errors = [];

  const fetchOne = async (provider) => {
    try {
      const row = getProviderByIdWithApiKey(provider.id, userId);
      if (!row) {
        errors.push({ providerId: provider.id, providerName: provider.name, error: 'Provider not found' });
        return null;
      }

      if (!row.api_key) {
        if (skipMissingApiKey) {
          return null; // Silently skip
        }
        errors.push({ providerId: provider.id, providerName: provider.name, error: 'Missing API key' });
        return null;
      }

      return await fetchModelsFromProvider(row, { http });
    } catch (err) {
      const errorMessage = err instanceof ProviderModelsError
        ? mapProviderStatusToMessage(err.status)
        : err.message || 'Unknown error';

      errors.push({
        providerId: provider.id,
        providerName: provider.name,
        error: errorMessage,
      });

      logger.warn({
        msg: 'modelFetch:provider_error',
        userId,
        providerId: provider.id,
        error: err.message,
      });

      return null;
    }
  };

  if (parallel) {
    const fetchResults = await Promise.all(providers.map(fetchOne));
    for (const result of fetchResults) {
      if (result) results.push(result);
    }
  } else {
    for (const provider of providers) {
      const result = await fetchOne(provider);
      if (result) results.push(result);
    }
  }

  return { providers: results, errors };
}
