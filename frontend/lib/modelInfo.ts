/**
 * Model metadata (context window, pricing) from `GET /v1/models/info`.
 * Results are cached in memory per provider + model for the session.
 */
import { httpClient, HttpError } from './http';

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
}

export interface ModelInfo {
  model: string;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing: ModelPricing | null;
}

const cache = new Map<string, Promise<ModelInfo | null>>();

function cacheKey(modelId: string, providerId: string | null) {
  return `${providerId ?? ''}::${modelId}`;
}

/**
 * Resolves to null when the model is unknown or the endpoint is unavailable
 * (404). Other failures also resolve to null but are not cached, so a later
 * call retries.
 */
export function fetchModelInfo(
  modelId: string,
  providerId: string | null
): Promise<ModelInfo | null> {
  const key = cacheKey(modelId, providerId);
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({ model: modelId });
  if (providerId) params.set('provider', providerId);

  const request = httpClient
    .get<ModelInfo>(`/v1/models/info?${params.toString()}`)
    .then((res) => (res.data && typeof res.data === 'object' ? res.data : null))
    .catch((err) => {
      if (!(err instanceof HttpError && err.status === 404)) cache.delete(key);
      return null;
    });

  cache.set(key, request);
  return request;
}

/** Test helper. */
export function clearModelInfoCache() {
  cache.clear();
}
