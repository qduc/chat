// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Set the API base to an empty string for all tests
process.env.NEXT_PUBLIC_API_BASE = '/api';
process.env.BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://localhost:3001';

// Polyfill TextEncoder/TextDecoder for Node/Jest environments
import { TextEncoder, TextDecoder } from 'util';
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// Add a small expect.poll helper used by tests: polls a function until the matcher passes or times out
expect.poll = (fn, { timeout = 1000, interval = 50 } = {}) => {
  const poll = async (matcher) => {
    const start = Date.now();

    while (true) {
      try {
        const value = fn();
        matcher(value);
        return;
      } catch (err) {
        if (Date.now() - start > timeout) throw err;
        // wait

        await new Promise((r) => setTimeout(r, interval));
      }
    }
  };
  return {
    toBe: (expected) => poll((v) => expect(v).toBe(expected)),
    toEqual: (expected) => poll((v) => expect(v).toEqual(expected)),
    toMatch: (expected) => poll((v) => expect(v).toMatch(expected)),
  };
};

// Ensure global.fetch exists and is mockable
// Minimal ReadableStream polyfill suitable for these tests
if (typeof global.ReadableStream === 'undefined') {
  class SimpleReadableStream {
    constructor(underlying) {
      this._chunks = [];
      this._closed = false;
      this._waiting = null;
      const controller = {
        enqueue: (chunk) => {
          this._chunks.push(chunk);
          if (this._waiting) {
            this._waiting.resolve();
            this._waiting = null;
          }
        },
        close: () => {
          this._closed = true;
          if (this._waiting) {
            this._waiting.resolve();
            this._waiting = null;
          }
        },
      };
      if (underlying && typeof underlying.start === 'function') {
        try {
          underlying.start(controller);
        } catch (e) {
          /* ignore */
        }
      }
    }
    getReader() {
      return {
        read: async () => {
          while (this._chunks.length === 0 && !this._closed) {
            // wait for new chunks
            await new Promise((resolve) => {
              this._waiting = { resolve };
            });
          }
          if (this._chunks.length === 0 && this._closed) {
            return { done: true, value: undefined };
          }
          const value = this._chunks.shift();
          return { done: false, value };
        },
      };
    }
  }
  global.ReadableStream = SimpleReadableStream;
}

// Minimal Response polyfill used by tests
if (typeof global.Response === 'undefined') {
  class ResponsePolyfill {
    constructor(body, init = {}) {
      this._rawBody = body;
      this.status = init.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
      const headerEntries = new Map();
      if (init.headers) {
        for (const [key, value] of Object.entries(init.headers)) {
          headerEntries.set(String(key).toLowerCase(), String(value));
        }
      } else if (typeof body === 'string') {
        headerEntries.set('content-type', 'application/json');
      } else if (body instanceof ReadableStream) {
        headerEntries.set('content-type', 'text/event-stream');
      }
      this.headers = {
        get: (name) => headerEntries.get(String(name).toLowerCase()) || null,
        has: (name) => headerEntries.has(String(name).toLowerCase()),
        set: (name, value) => {
          headerEntries.set(String(name).toLowerCase(), String(value));
        },
        append: (name, value) => {
          const key = String(name).toLowerCase();
          const existing = headerEntries.get(key);
          headerEntries.set(key, existing ? `${existing}, ${value}` : String(value));
        },
      };
      // If body is string, expose a ReadableStream over the encoded string
      if (typeof body === 'string') {
        const encoder = new TextEncoder();
        this.body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(body));
            controller.close();
          },
        });
      } else {
        this.body = body;
      }
    }
    async json() {
      if (typeof this._rawBody === 'string') return JSON.parse(this._rawBody);
      if (this.body && typeof this.body.getReader === 'function') {
        const reader = this.body.getReader();
        const dec = new TextDecoder();
        let out = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          out += dec.decode(value, { stream: true });
        }
        return JSON.parse(out);
      }
      return null;
    }
    async text() {
      if (typeof this._rawBody === 'string') return this._rawBody;
      if (this.body && typeof this.body.getReader === 'function') {
        const reader = this.body.getReader();
        const dec = new TextDecoder();
        let out = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          out += dec.decode(value, { stream: true });
        }
        return out;
      }
      return '';
    }
    async blob() {
      const text = await this.text();
      if (typeof Blob !== 'undefined') {
        return new Blob([text], { type: this.headers.get('content-type') || 'text/plain' });
      }
      return { size: text.length, type: this.headers.get('content-type') || 'text/plain' };
    }
  }
  global.Response = ResponsePolyfill;
}

// Provide a default mocked fetch that can be spied on / overridden by tests.
const createDefaultFetchResponse = () => {
  const ResponseCtor = global.Response;
  if (typeof ResponseCtor !== 'function') {
    throw new Error('Response constructor not available for default fetch mock');
  }
  return new ResponseCtor('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

Object.defineProperty(global, 'fetch', {
  value: jest.fn(() => Promise.resolve(createDefaultFetchResponse())),
  writable: true,
  configurable: true,
});

// Mock scrollIntoView as it's not available in jsdom
Element.prototype.scrollIntoView = jest.fn();

// Mock the HTTP client to prevent real network requests during tests while still
// flowing through the Jest-level fetch mocks used by unit tests.
jest.mock('./lib/http', () => {
  const defaultApiBase =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api`
      : process.env.NEXT_PUBLIC_API_BASE || 'http://backend:3001/api';

  const resolveUrl = (url = '') =>
    url.startsWith('http') ? url : `${defaultApiBase}${url.startsWith('/') ? url : `/${url}`}`;

  const asHeaders = (headers) => {
    if (
      headers &&
      typeof headers === 'object' &&
      typeof headers.append === 'function' &&
      typeof headers.get === 'function'
    ) {
      return headers;
    }
    const result = new Headers();
    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            result.append(key, v);
          }
        } else if (value !== undefined) {
          result.append(key, String(value));
        }
      }
    }
    return result;
  };

  const mockHttpResponse = (data, status = 200, headers = new Headers(), statusText) => ({
    data,
    status,
    statusText: statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
    headers: asHeaders(headers),
  });

  class HttpError extends Error {
    constructor(status, message, response, data) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
      this.response = response;
      this.data = data;
    }
  }

  const callFetch = async (method, url, body, options = {}) => {
    if (typeof global.fetch !== 'function') {
      throw new Error('global.fetch is not defined');
    }

    const headers = { ...(options.headers || {}) };
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    if (method !== 'GET' && body !== undefined) {
      if (isFormData) {
        delete headers['Content-Type'];
      } else if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const init = {
      method,
      headers,
      credentials: options.credentials ?? 'include',
      signal: options.signal,
    };

    if (method !== 'GET' && body !== undefined) {
      if (isFormData) {
        init.body = body;
      } else if (typeof body === 'string') {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
      }
    }

    const response = await global.fetch(resolveUrl(url), init);
    if (!response) {
      throw new HttpError(0, 'No response received from fetch', null, null);
    }

    const contentType = response.headers?.get?.('content-type') || '';

    const handleError = async () => {
      let errorData;
      if (contentType.includes('application/json')) {
        try {
          errorData = await response.json();
        } catch {
          errorData = undefined;
        }
      } else {
        try {
          const text = await response.text();
          errorData = text ? { message: text } : undefined;
        } catch {
          errorData = undefined;
        }
      }

      const detail =
        errorData?.error?.message || errorData?.error || errorData?.message || response.statusText;

      throw new HttpError(
        response.status,
        `HTTP ${response.status}: ${detail}`,
        response,
        errorData
      );
    };

    if (!response.ok) {
      await handleError();
    }

    if (contentType.includes('text/event-stream')) {
      return mockHttpResponse(response, response.status, response.headers, response.statusText);
    }

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return mockHttpResponse(data, response.status, response.headers, response.statusText);
    }

    if (contentType.includes('text/')) {
      const text = await response.text();
      return mockHttpResponse(text, response.status, response.headers, response.statusText);
    }

    if (typeof response.blob === 'function') {
      const blob = await response.blob();
      return mockHttpResponse(blob, response.status, response.headers, response.statusText);
    }

    const fallback = await response.text?.();
    return mockHttpResponse(fallback, response.status, response.headers, response.statusText);
  };

  const httpClient = {
    get: jest.fn((url, options = {}) => callFetch('GET', url, undefined, options)),
    post: jest.fn((url, body, options = {}) => callFetch('POST', url, body, options)),
    patch: jest.fn((url, body, options = {}) => callFetch('PATCH', url, body, options)),
    delete: jest.fn((url, options = {}) => callFetch('DELETE', url, undefined, options)),
    put: jest.fn((url, body, options = {}) => callFetch('PUT', url, body, options)),
    request: jest.fn((url, options = {}) =>
      callFetch(options.method || 'GET', url, options.body, options)
    ),
    setRefreshTokenFn: jest.fn(),
  };

  return {
    httpClient,
    HttpError,
    mockHttpResponse,
  };
});

// Suppress React act warnings for async useEffect calls in testing
// This is needed because useSystemPrompts makes HTTP calls on mount
const originalConsoleError = console.error;
console.error = (...args) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('An update to') &&
    args[0].includes('was not wrapped in act')
  ) {
    // Suppress act warnings for async operations in useSystemPrompts
    return;
  }
  originalConsoleError(...args);
};

// Provide a basic mock for next/navigation hooks so components can render in JSDOM without the App Router
jest.mock('next/navigation', () => {
  // We don't need the real module in tests; return minimal stubs
  return {
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => {
      const params = new URLSearchParams();
      return {
        get: params.get.bind(params),
        getAll: params.getAll.bind(params),
        has: params.has.bind(params),
        entries: params.entries.bind(params),
        forEach: params.forEach.bind(params),
        keys: params.keys.bind(params),
        values: params.values.bind(params),
        toString: params.toString.bind(params),
        [Symbol.iterator]: params[Symbol.iterator].bind(params),
      };
    },
  };
});
