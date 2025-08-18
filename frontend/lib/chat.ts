// Simple streaming chat client for OpenAI-compatible /v1/chat/completions
// Parses Server-Sent Events style stream and aggregates delta content.

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface SendChatOptions {
  apiBase?: string; // override base; when omitted, uses frontend proxy
  messages: { role: Role; content: string }[];
  model?: string;
  signal?: AbortSignal;
  onToken?: (token: string) => void; // called for each delta
  conversationId?: string; // Sprint 4: pass conversation id
}

// Default to calling the frontend's local proxy under /api.
// This will be rewritten to the backend by Next.js rewrites.
const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || '/api';

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
  const { apiBase = defaultApiBase, messages, model, signal, onToken, conversationId } = options;
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    conversation_id: conversationId,
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

// --- Sprint 4: History API helpers ---
export interface ConversationMeta { id: string; title?: string | null; model?: string | null; created_at: string; }
export interface ConversationsList { items: ConversationMeta[]; next_cursor: string | null; }

async function handleJSON(res: Response) {
  if (!res.ok) {
    let err: any = { status: res.status };
    try { err.body = await res.json(); } catch {}
    const msg = err.body?.message || err.body?.error || `HTTP ${res.status}`;
    const e = new Error(msg) as any; e.status = res.status; e.body = err.body; throw e;
  }
  return res.json();
}

export async function createConversation(apiBase = defaultApiBase, init?: { title?: string; model?: string; }) {
  const res = await fetch(`${apiBase}/v1/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init || {})
  });
  return handleJSON(res) as Promise<ConversationMeta>;
}

export async function listConversationsApi(apiBase = defaultApiBase, params?: { cursor?: string; limit?: number; }) {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const res = await fetch(`${apiBase}/v1/conversations?${qs.toString()}`, { method: 'GET' });
  return handleJSON(res) as Promise<ConversationsList>;
}

export async function getConversationApi(apiBase = defaultApiBase, id: string, params?: { after_seq?: number; limit?: number; }) {
  const qs = new URLSearchParams();
  if (params?.after_seq) qs.set('after_seq', String(params.after_seq));
  if (params?.limit) qs.set('limit', String(params.limit));
  const res = await fetch(`${apiBase}/v1/conversations/${id}?${qs.toString()}`, { method: 'GET' });
  return handleJSON(res) as Promise<{ id: string; title?: string; model?: string; created_at: string; messages: { id: number; seq: number; role: Role; status: string; content: string; created_at: string; }[]; next_after_seq: number | null; }>;
}

export async function deleteConversationApi(apiBase = defaultApiBase, id: string) {
  const res = await fetch(`${apiBase}/v1/conversations/${id}`, { method: 'DELETE' });
  if (res.status === 204) return true;
  await handleJSON(res);
  return true;
}
