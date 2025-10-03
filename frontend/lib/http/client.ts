/**
 * Centralized HTTP client with automatic token refresh on 401 errors
 */

import { authApi } from '../auth/api';
import { getToken, clearTokens, isTokenExpired } from '../auth/tokens';
import { setAuthReady } from '../auth/ready';
import { HttpClientOptions, RequestOptions, HttpResponse, HttpError, QueuedRequest } from './types';

class AuthenticatedHttpClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number;
  private isRefreshing = false;
  private requestQueue: QueuedRequest[] = [];

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';
    this.timeout = options.timeout || 30000;
    this.retries = options.retries || 1;
  }

  /**
   * Make an HTTP request with automatic 401 handling
   */
  async request<T = any>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url.startsWith('/') ? url : `/${url}`}`;

    // If we're currently refreshing tokens, queue this request
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          resolve,
          reject,
          request: () => this.makeRequest<T>(fullUrl, options)
        });
      });
    }

    return this.makeRequest<T>(fullUrl, options);
  }

  /**
   * Internal method to make the actual HTTP request
   */
  private async makeRequest<T>(url: string, options: RequestOptions): Promise<HttpResponse<T>> {
    const requestInit = this.buildRequestInit(options);

    try {
      const response = await fetch(url, requestInit);

      // Handle 401 errors with token refresh
      if (response.status === 401 && !options.skipRetry && !options.skipAuth) {
        return this.handleUnauthorized<T>(url, options);
      }

      // Handle other errors
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await this.parseResponse<T>(response);

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(0, `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle 401 unauthorized errors with token refresh
   */
  private async handleUnauthorized<T>(url: string, options: RequestOptions): Promise<HttpResponse<T>> {
    // Check if we have a refresh token
    const currentToken = getToken();
    if (!currentToken || this.isRefreshing) {
      throw new HttpError(401, 'Authentication required');
    }

    // Start the refresh process
    this.isRefreshing = true;
    setAuthReady(false);

    try {
      // Attempt to refresh the token
      await authApi.refreshToken();

      // Process queued requests with new token
      await this.processRequestQueue();

      // Retry the original request with new token
      const retryOptions = { ...options, skipRetry: true }; // Prevent infinite retry loop
      return await this.makeRequest<T>(url, retryOptions);

    } catch (refreshError) {
      // Refresh failed - clear tokens and auth state
      clearTokens();
      setAuthReady(true);

      // Reject all queued requests
      this.requestQueue.forEach(({ reject }) => {
        reject(new HttpError(401, 'Authentication expired'));
      });
      this.requestQueue = [];

      throw new HttpError(401, 'Authentication expired');
    } finally {
      this.isRefreshing = false;
      setAuthReady(true);
    }
  }

  /**
   * Process all queued requests after successful token refresh
   */
  private async processRequestQueue(): Promise<void> {
    const queue = [...this.requestQueue];
    this.requestQueue = [];

    await Promise.allSettled(
      queue.map(async ({ resolve, reject, request }) => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      })
    );
  }

  /**
   * Build RequestInit object with authentication headers
   */
  private buildRequestInit(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      ...options.headers
    };

    // Only set Content-Type for JSON if body is not FormData
    // FormData requires browser to set Content-Type with boundary
    const isFormData = options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Remove Content-Type if explicitly set for FormData (browser will handle it)
    if (isFormData && headers['Content-Type']) {
      delete headers['Content-Type'];
    }

    // Add authentication header if not skipped and token exists
    if (!options.skipAuth && typeof window !== 'undefined') {
      const token = getToken();
      if (token && !isTokenExpired(token)) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const init: RequestInit = {
      method: options.method || 'GET',
      headers,
      credentials: options.credentials || 'include',
      signal: options.signal
    };

    // Add body for non-GET requests
    if (options.body !== undefined && options.method !== 'GET') {
      if (isFormData) {
        // Pass FormData directly, browser will handle serialization and Content-Type
        init.body = options.body;
      } else if (typeof options.body === 'string') {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
      }
    }

    return init;
  }

  /**
   * Handle error responses
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: any;
    let errorMessage = `HTTP ${response.status}`;

    try {
      errorData = await response.json();
      errorMessage += `: ${errorData.error || errorData.message || JSON.stringify(errorData)}`;
    } catch {
      // Ignore JSON parse errors
      errorMessage += `: ${response.statusText}`;
    }

    throw new HttpError(response.status, errorMessage, response, errorData);
  }

  /**
   * Parse response data
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');

    // For streaming responses, return the raw response
    if (contentType?.includes('text/event-stream')) {
      return response as unknown as T;
    }

    if (contentType?.includes('application/json')) {
      return response.json();
    }

    if (contentType?.includes('text/')) {
      return response.text() as unknown as T;
    }

    return response.blob() as unknown as T;
  }

  /**
   * Convenience methods for common HTTP verbs
   */
  async get<T = any>(url: string, options: Omit<RequestOptions, 'method'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async post<T = any>(url: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'POST', body });
  }

  async put<T = any>(url: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PUT', body });
  }

  async patch<T = any>(url: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PATCH', body });
  }

  async delete<T = any>(url: string, options: Omit<RequestOptions, 'method'> = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }
}

// Export singleton instance
export const httpClient = new AuthenticatedHttpClient();

// Export class for custom instances
export { AuthenticatedHttpClient };