import { logger } from '../logger.js';

/**
 * Configuration for retry behavior
 * @typedef {Object} RetryConfig
 * @property {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @property {number} initialDelayMs - Initial delay in milliseconds (default: 1000)
 * @property {number} maxDelayMs - Maximum delay in milliseconds (default: 60000)
 * @property {number} backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @property {number} jitterFactor - Random jitter factor 0-1 (default: 0.1)
 * @property {Function} shouldRetry - Function to determine if error should trigger retry
 */

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  shouldRetry: (error, _attempt) => {
    // Only retry on 429 (rate limit) and 5xx server errors
    if (error?.status === 429) return true;
    if (error?.status >= 500 && error?.status < 600) return true;
    return false;
  },
};

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @param {RetryConfig} config - Retry configuration
 * @returns {number} Delay in milliseconds
 */
function calculateDelay(attempt, config) {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add random jitter to prevent thundering herd
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = Math.max(0, cappedDelay + jitter);

  return Math.round(finalDelay);
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract status code from error or response
 * @param {Error|Response} errorOrResponse - Error object or fetch Response
 * @returns {number|null} HTTP status code or null
 */
function extractStatusCode(errorOrResponse) {
  if (errorOrResponse?.status) return errorOrResponse.status;
  if (errorOrResponse?.response?.status) return errorOrResponse.response.status;
  return null;
}

/**
 * Check if response indicates a retryable error
 * @param {Response} response - Fetch response
 * @returns {boolean}
 */
function isRetryableResponse(response) {
  if (!response) return false;
  const status = response.status;
  // Retry on 429 (rate limit) and 5xx (server errors)
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {RetryConfig} userConfig - User-provided retry configuration
 * @returns {Promise<any>} Result of successful function execution
 * @throws {Error} Final error after all retries exhausted
 */
export async function retryWithBackoff(fn, userConfig = {}) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...userConfig };
  let lastError = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();

      // Check if result is a Response object with error status
      if (result && typeof result.ok !== 'undefined' && !result.ok) {
        // Read error body for logging
        let errorBody = '';
        try {
          const clonedResponse = result.clone();
          errorBody = await clonedResponse.text();
        } catch (_e) {
          errorBody = 'Could not read error body';
        }

        const error = new Error(`Upstream API error (${result.status}): ${errorBody}`);
        error.status = result.status;
        error.response = result;

        // Check if we should retry using custom shouldRetry function
        if (attempt < config.maxRetries && config.shouldRetry(error, attempt)) {
          const delay = error.retryAfterMs || calculateDelay(attempt, config);
          logger.warn({
            msg: '[retry] Retryable error encountered',
            status: result.status,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            retryAfterMs: delay,
            errorPreview: errorBody.slice(0, 200),
          });
          await sleep(delay);
          continue;
        }

        // No more retries or not retryable - throw error for retryable status codes
        // otherwise return the result for client to handle
        if (isRetryableResponse(result)) {
          throw error;
        }
        return result;
      }

      // Success case
      if (attempt > 0) {
        logger.info({
          msg: '[retry] Request succeeded after retry',
          attempt: attempt + 1,
        });
      }
      return result;

    } catch (error) {
      lastError = error;
      const status = extractStatusCode(error);

      // Attach status to error if not already present
      if (status && !error.status) {
        error.status = status;
      }

      // Check if we should retry
      if (attempt < config.maxRetries && config.shouldRetry(error, attempt)) {
        const delay = error.retryAfterMs || calculateDelay(attempt, config);
        logger.warn({
          msg: '[retry] Retryable error encountered',
          error: error.message,
          status: error.status,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          retryAfterMs: delay,
        });
        await sleep(delay);
        continue;
      }

      // No more retries or not retryable
      throw error;
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Retry exhausted with unknown error');
}

/**
 * Wrap a fetch-like function with retry logic
 * @param {Function} fetchFn - Fetch function to wrap
 * @param {RetryConfig} config - Retry configuration
 * @returns {Function} Wrapped fetch function with retry logic
 */
export function withRetry(fetchFn, config = {}) {
  return async (...args) => {
    return retryWithBackoff(() => fetchFn(...args), config);
  };
}
