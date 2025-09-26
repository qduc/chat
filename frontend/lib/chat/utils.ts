export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorBody: any;
    try {
      errorBody = await response.json();
    } catch {
      // Ignore JSON parse errors
    }

    const message = errorBody?.message || errorBody?.error || `HTTP ${response.status}`;
    throw new APIError(response.status, message, errorBody);
  }

  return response.json();
}

export interface SSEEvent {
  type: 'data' | 'done';
  data?: any;
}

export class SSEParser {
  private buffer = '';

  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);

      if (!line) continue;

      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          events.push({ type: 'done' });
        } else {
          try {
            const json = JSON.parse(data);
            events.push({ type: 'data', data: json });
          } catch (e) {
            // Ignore malformed JSON
          }
        }
      }
    }

    return events;
  }

  reset() {
    this.buffer = '';
  }
}

export function createRequestInit(body: any, options: { stream?: boolean; signal?: AbortSignal }): RequestInit {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.stream ? { 'Accept': 'text/event-stream' } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
  };

  // Add authentication header if token exists
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('chatforge_auth_token');
    if (token) {
      (init.headers as any)['Authorization'] = `Bearer ${token}`;
    }
  }

  if (options.signal) {
    init.signal = options.signal;
  }

  return init;
}

// Provider utilities
export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  enabled: number;
  updated_at: string;
}

let cachedDefaultProvider: string | null = null;

export async function getDefaultProviderId(apiBase: string = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'): Promise<string> {
  if (cachedDefaultProvider) {
    return cachedDefaultProvider;
  }

  try {
    const headers: Record<string, string> = {};

    // Add authentication header if token exists
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('chatforge_auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${apiBase}/v1/providers`, {
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch providers: ${response.status}`);
    }

    const json = await response.json();
    const providers: Provider[] = Array.isArray(json.providers) ? json.providers : [];
    const enabledProviders = providers.filter(p => p.enabled === 1);

    if (enabledProviders.length === 0) {
      throw new Error('No enabled providers found');
    }

    // Sort by updated_at desc to get the most recent one
    enabledProviders.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    cachedDefaultProvider = enabledProviders[0].id;
    return cachedDefaultProvider;
  } catch (error) {
    console.error('Failed to get default provider:', error);
    throw new Error('Unable to determine default provider');
  }
}

export function clearProviderCache() {
  cachedDefaultProvider = null;
}
