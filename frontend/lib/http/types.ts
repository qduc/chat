/**
 * HTTP client types for authenticated requests with automatic token refresh
 */

export interface HttpClientOptions {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  skipAuth?: boolean;  // Skip adding auth headers
  skipRetry?: boolean; // Skip 401 retry logic
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public response?: Response,
    public data?: any
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface QueuedRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  request: () => Promise<any>;
}