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

  if (options.signal) {
    init.signal = options.signal;
  }

  return init;
}
