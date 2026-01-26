/**
 * Tests for HTTP client
 * @jest-environment jsdom
 *
 * Note: The http module is mocked in jest.setup.js with an implementation
 * that calls global.fetch. These tests verify the mock behavior which mirrors
 * the real implementation's contract.
 */

import { httpClient, HttpError } from '../lib/http';

// Create response helper
function createJsonResponse(
  data: any,
  options: { status?: number; headers?: Record<string, string> } = {}
) {
  const { status = 200, headers = {} } = options;
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function createTextResponse(text: string, options: { status?: number } = {}) {
  const { status = 200 } = options;
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

function createStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('httpClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock to default behavior
    (global.fetch as jest.Mock).mockReset();
  });

  describe('GET requests', () => {
    it('makes GET request and returns JSON data', async () => {
      const mockData = { id: 1, name: 'Test' };
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse(mockData));

      const response = await httpClient.get('/v1/test');

      expect(response.data).toEqual(mockData);
      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/test'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('resolves relative URLs with base', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.get('/v1/endpoint');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/endpoint$/),
        expect.any(Object)
      );
    });

    it('uses absolute URLs as-is', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.get('https://other-api.com/endpoint');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://other-api.com/endpoint',
        expect.any(Object)
      );
    });

    it('includes credentials by default', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.get('/v1/test');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: 'include' })
      );
    });
  });

  describe('POST requests', () => {
    it('sends JSON body', async () => {
      const requestBody = { message: 'Hello' };
      const responseData = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse(responseData));

      const response = await httpClient.post('/v1/test', requestBody);

      expect(response.data).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('handles FormData without Content-Type header', async () => {
      const formData = new FormData();
      formData.append('file', 'test-content');
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({ uploaded: true }));

      await httpClient.post('/v1/upload', formData);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toBe(formData);
      // Content-Type should not be set for FormData (browser handles it)
      expect(options.headers['Content-Type']).toBeUndefined();
    });

    it('sends string body as-is', async () => {
      const stringBody = 'raw string content';
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.post('/v1/test', stringBody);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toBe(stringBody);
    });
  });

  describe('PUT requests', () => {
    it('makes PUT request with body', async () => {
      const body = { name: 'Updated' };
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({ id: 1 }));

      await httpClient.put('/v1/items/1', body);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('PATCH requests', () => {
    it('makes PATCH request with body', async () => {
      const body = { status: 'active' };
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({ updated: true }));

      await httpClient.patch('/v1/items/1', body);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('DELETE requests', () => {
    it('makes DELETE request', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({ deleted: true }));

      await httpClient.delete('/v1/items/1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Error handling', () => {
    it('throws HttpError for 4xx responses', async () => {
      const errorData = { error: { message: 'Not found' } };
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createJsonResponse(errorData, { status: 404 })
      );

      await expect(httpClient.get('/v1/missing')).rejects.toThrow(HttpError);

      // Set up mock again for second assertion
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createJsonResponse(errorData, { status: 404 })
      );
      await expect(httpClient.get('/v1/missing')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('throws HttpError for 5xx responses', async () => {
      const errorData = { message: 'Internal server error' };
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createJsonResponse(errorData, { status: 500 })
      );

      await expect(httpClient.get('/v1/broken')).rejects.toThrow(HttpError);
    });

    it('includes error data in HttpError', async () => {
      const errorData = { error: { message: 'Validation failed', code: 'INVALID' } };
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createJsonResponse(errorData, { status: 400 })
      );

      try {
        await httpClient.post('/v1/validate', { bad: 'data' });
        fail('Expected HttpError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(400);
        expect(httpError.data).toEqual(errorData);
      }
    });

    it('handles network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

      await expect(httpClient.get('/v1/test')).rejects.toThrow();
    });
  });

  describe('Response handling', () => {
    it('handles JSON responses', async () => {
      const data = { items: [1, 2, 3] };
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse(data));

      const response = await httpClient.get('/v1/items');
      expect(response.data).toEqual(data);
    });

    it('handles text responses', async () => {
      const text = 'Plain text content';
      (global.fetch as jest.Mock).mockResolvedValueOnce(createTextResponse(text));

      const response = await httpClient.get('/v1/text');
      expect(response.data).toBe(text);
    });

    it('handles streaming responses', async () => {
      const chunks = ['data: {"chunk": 1}\n\n', 'data: {"chunk": 2}\n\n'];
      (global.fetch as jest.Mock).mockResolvedValueOnce(createStreamResponse(chunks));

      const response = await httpClient.get('/v1/stream');
      // For streaming responses, the raw Response is returned
      expect(response.data).toBeDefined();
    });
  });

  describe('Request options', () => {
    it('passes custom headers', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.get('/v1/test', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    it('passes abort signal', async () => {
      const controller = new AbortController();
      (global.fetch as jest.Mock).mockResolvedValueOnce(createJsonResponse({}));

      await httpClient.get('/v1/test', { signal: controller.signal });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });
  });

  describe('setRefreshTokenFn', () => {
    it('accepts a refresh token function', () => {
      const refreshFn = jest.fn();
      // This should not throw
      httpClient.setRefreshTokenFn(refreshFn);
      expect(refreshFn).not.toHaveBeenCalled();
    });
  });
});

describe('HttpError', () => {
  it('extends Error', () => {
    const error = new HttpError(404, 'Not found');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(HttpError);
  });

  it('has correct properties', () => {
    const response = new Response('{}');
    const data = { code: 'NOT_FOUND' };
    const error = new HttpError(404, 'Not found', response, data);

    expect(error.status).toBe(404);
    expect(error.message).toBe('Not found');
    expect(error.response).toBe(response);
    expect(error.data).toBe(data);
    expect(error.name).toBe('HttpError');
  });
});
