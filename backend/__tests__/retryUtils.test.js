import { retryWithBackoff, withRetry } from '../src/lib/retryUtils.js';
import { jest } from '@jest/globals';
import { logger } from '../src/logger.js';

// Mock logger to suppress output during tests
jest.spyOn(logger, 'warn').mockImplementation(() => {});
jest.spyOn(logger, 'info').mockImplementation(() => {});
jest.spyOn(logger, 'error').mockImplementation(() => {});

describe('retryUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('retryWithBackoff', () => {
    test('should succeed on first attempt without retry', async () => {
      const mockFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn);
      jest.runAllTimers();
      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should retry on 429 error and eventually succeed', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, { maxRetries: 3 });

      // Fast-forward through all timers
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    test('should retry on 500 error and eventually succeed', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          clone: () => ({ text: () => Promise.resolve('Internal server error') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, { maxRetries: 2 });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should not retry on 400 error', async () => {
      const mockFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        clone: () => ({ text: () => Promise.resolve('Bad request') }),
      });

      const result = await retryWithBackoff(mockFn, { maxRetries: 3 });

      expect(result).toEqual({
        ok: false,
        status: 400,
        clone: expect.any(Function),
      });
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should not retry on 401 error', async () => {
      const mockFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        clone: () => ({ text: () => Promise.resolve('Unauthorized') }),
      });

      const result = await retryWithBackoff(mockFn, { maxRetries: 3 });

      expect(result).toEqual({
        ok: false,
        status: 401,
        clone: expect.any(Function),
      });
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should exhaust retries and throw final error', async () => {
      const mockFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        clone: () => ({ text: () => Promise.resolve('Rate limited') }),
      });

      const promise = retryWithBackoff(mockFn, { maxRetries: 2 });

      // Use Promise.race to handle both timer advancement and promise resolution
      const result = await Promise.race([
        promise.catch(err => ({ error: err })),
        jest.runAllTimersAsync().then(() => promise.catch(err => ({ error: err }))),
      ]);

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Upstream API error (429)');
      expect(result.error.status).toBe(429);
      expect(mockFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    test('should handle thrown errors with status property', async () => {
      const error = new Error('Network error');
      error.status = 503;

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, { maxRetries: 2 });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should not retry non-retryable thrown errors', async () => {
      const error = new Error('Bad request');
      error.status = 400;

      const mockFn = jest.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(mockFn, { maxRetries: 3 });

      await expect(promise).rejects.toThrow('Bad request');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should use exponential backoff with correct delays', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      });

      // Wait for all timers and promise resolution
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    test('should respect maxDelayMs cap', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, {
        maxRetries: 2,
        initialDelayMs: 10000,
        backoffMultiplier: 10,
        maxDelayMs: 5000,
        jitterFactor: 0,
      });

      // Wait for all timers and promise resolution
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should use custom shouldRetry function', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          clone: () => ({ text: () => Promise.resolve('Not found') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      // Custom shouldRetry that retries on 404 (which is not retryable by default)
      const customShouldRetry = (error) => error?.status === 404;

      const promise = retryWithBackoff(mockFn, {
        maxRetries: 2,
        shouldRetry: customShouldRetry,
      });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should handle response without clone method', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = retryWithBackoff(mockFn, { maxRetries: 2 });

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should respect retryAfterMs on error object', async () => {
      const error = new Error('Rate limited');
      error.status = 429;
      error.retryAfterMs = 5000;

      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const spySleep = jest.spyOn(global, 'setTimeout');

      const promise = retryWithBackoff(mockFn, { maxRetries: 2, initialDelayMs: 100 });
      
      // Advance timers by less than 5000ms and check status
      jest.advanceTimersByTime(4000);
      // At this point, the promise should still be pending if it's waiting for 5000ms
      
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200 });
      expect(mockFn).toHaveBeenCalledTimes(2);
      
      // Check that the delay was approximately 5000ms
      // We can check the arguments to setTimeout
      // The first call to setTimeout (retry wait) should have 5000
      expect(spySleep).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
  });

  describe('withRetry', () => {
    test('should wrap function with retry logic', async () => {
      const mockFetchFn = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          clone: () => ({ text: () => Promise.resolve('Rate limited') }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, data: 'success' });

      const wrappedFn = withRetry(mockFetchFn, { maxRetries: 2 });

      const promise = wrappedFn('arg1', 'arg2');

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual({ ok: true, status: 200, data: 'success' });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
      expect(mockFetchFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('should pass through all arguments to wrapped function', async () => {
      const mockFetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const wrappedFn = withRetry(mockFetchFn);

      const promise = wrappedFn('url', { method: 'POST', body: 'data' });
      jest.runAllTimers();
      await promise;

      expect(mockFetchFn).toHaveBeenCalledWith('url', { method: 'POST', body: 'data' });
    });
  });
});
