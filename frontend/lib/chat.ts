// Simple streaming chat client for OpenAI-compatible /v1/chat/completions
// Parses Server-Sent Events style stream and aggregates delta content.

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface SendChatOptions {
  apiBase?: string; // override base
  messages: { role: Role; content: string }[];
  model?: string;
  signal?: AbortSignal;
  onToken?: (token: string) => void; // called for each delta
}

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';

interface OpenAIStreamChunkChoiceDelta {
  role?: Role;
  content?: string;
}
interface OpenAIStreamChunkChoice {
  delta?: OpenAIStreamChunkChoiceDelta;
  finish_reason?: string | null;
}
interface OpenAIStreamChunk {
  choices?: OpenAIStreamChunkChoice[];
}

export async function sendChat(options: SendChatOptions): Promise<string> {
  const { apiBase = defaultApiBase, messages, model, signal, onToken } = options;
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
  });

  const res = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg += `: ${j.error || j.message || JSON.stringify(j)}`;
    } catch (_) {}
    throw new Error(msg);
  }

  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let assistant = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          return assistant;
        }
        try {
          const json: OpenAIStreamChunk = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const token = delta?.content || '';
          if (token) {
            assistant += token;
            onToken?.(token);
          }
        } catch (e) {
          // ignore malformed lines
        }
      }
    }
  }
  return assistant;
}
