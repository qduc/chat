// Simple streaming chat client for OpenAI Responses API with Chat Completions fallback
// Parses Server-Sent Events style stream and aggregates delta content.

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  tool_calls?: any[]; // Array of tool calls
  tool_call_id?: string; // ID of the tool call
  tool_outputs?: Array<{ tool_call_id?: string; name?: string; output: any }>; // tool outputs matched by call id or name
}

export interface SendChatOptions {
  apiBase?: string; // override base; when omitted, uses frontend proxy
  messages: { role: Role; content: string }[];
  model?: string;
  signal?: AbortSignal;
  onEvent?: (event: any) => void; // called for each event
  onToken?: (token: string) => void; // called for each text delta token
  conversationId?: string; // Sprint 4: pass conversation id
  useResponsesAPI?: boolean; // whether to use new Responses API (default: true)
  previousResponseId?: string; // for Responses API conversation continuity
  tools?: any[]; // optional OpenAI tool specifications (Chat Completions only for now)
  tool_choice?: any; // optional tool_choice
  stream?: boolean; // whether to stream response (default: true)
  shouldStream?: boolean; // alias for stream to avoid env collisions
  research_mode?: boolean; // enable multi-step research mode with iterative tool usage
}

// API base URL - can be direct backend URL or proxy path
// Direct backend: http://localhost:3001 (for development)
// Proxy path: /api (legacy Next.js proxy - deprecated)
const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';

// Chat Completions API streaming format
interface OpenAIStreamChunkChoiceDelta {
  role?: Role;
  content?: string;
  tool_calls?: any[];
  tool_output?: any; // Custom field for our iterative orchestration
}

interface OpenAIStreamChunkChoice {
  delta?: OpenAIStreamChunkChoiceDelta;
  finish_reason?: string | null;
}
interface OpenAIStreamChunk {
  choices?: OpenAIStreamChunkChoice[];
}

// Responses API streaming format
interface ResponsesAPIStreamChunk {
  type?: string;
  delta?: string;
  item_id?: string;
  response?: {
    id: string;
    model: string;
    output: Array<{
      content: Array<{
        text: string;
      }>;
    }>;
  };
}

export async function sendChat(options: SendChatOptions): Promise<{ content: string; responseId?: string }> {
  const { apiBase = defaultApiBase, messages, model, signal, onEvent, onToken, conversationId, useResponsesAPI, previousResponseId, tools, tool_choice, research_mode } = options;
  const streamFlag = options.shouldStream !== undefined
    ? !!options.shouldStream
    : (options.stream === undefined ? true : !!options.stream);
  // Decide which API to use. If tools/tool_choice are provided, force Chat Completions.
  const useResponses = useResponsesAPI !== undefined ? useResponsesAPI : !(Array.isArray(tools) && tools.length > 0 || tool_choice !== undefined);
  const bodyObj: any = {
    model,
    messages,
    stream: streamFlag,
    conversation_id: conversationId,
    ...(useResponses && previousResponseId && { previous_response_id: previousResponseId }),
    ...(research_mode && { research_mode: true }),
  };
  // Only attach tools when not using Responses API (we use Chat Completions for tools)
  if (!useResponses && Array.isArray(tools) && tools.length > 0) {
    bodyObj.tools = tools;
    if (tool_choice !== undefined) bodyObj.tool_choice = tool_choice;
  }
  const body = JSON.stringify(bodyObj);

  // Use Responses API by default, fallback to Chat Completions if disabled
  const endpoint = useResponses ? '/v1/responses' : '/v1/chat/completions';
  const fetchInit: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Hint to proxies/browsers that we expect an SSE stream (only for streaming)
      ...(streamFlag ? { 'Accept': 'text/event-stream' } : {}),
    },
    body,
  };
  if (signal) fetchInit.signal = signal;
  const res = await fetch(`${apiBase}${endpoint}`, fetchInit);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg += `: ${j.error || j.message || JSON.stringify(j)}`;
    } catch (_) {}
    throw new Error(msg);
  }

  // Non-streaming: parse JSON and return content immediately
  if (!streamFlag) {
    const json = await res.json();
    if (useResponses) {
      // Responses API non-stream JSON
      const content = json?.output?.[0]?.content?.[0]?.text ?? '';
      const responseId = json?.id;
      return { content, responseId };
    } else {
      // Chat Completions API non-stream JSON
      const content = json?.choices?.[0]?.message?.content ?? '';
      const responseId = json?.id;
      return { content, responseId };
    }
  }

  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let assistant = '';
  let buffer = '';
  let responseId: string | undefined;

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
          return { content: assistant, responseId };
        }
        try {
          const json = JSON.parse(data);

          if (useResponses) {
            // Handle "Responses API" stream format
            const chunk = json as any;
            if (chunk.type === 'response.output_text.delta' && chunk.delta) {
              assistant += chunk.delta;
              onToken?.(chunk.delta);
              onEvent?.({ type: 'text', value: chunk.delta });
            } else if (chunk.type === 'response.output_item.done' && chunk.item?.content?.[0]?.text) {
              // This handles the final message content when streaming is done.
              const finalText = chunk.item.content[0].text;
              assistant = finalText; // Replace assistant content with the final version.
              onEvent?.({ type: 'final', value: finalText });
            }
            if (chunk.type === 'response.completed' && chunk.response?.id) {
              responseId = chunk.response.id;
            }
          } else {
            // Handle "Chat Completions API" stream format (for tools)
            const chunk = json as OpenAIStreamChunk;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              assistant += delta.content;
              onToken?.(delta.content);
              onEvent?.({ type: 'text', value: delta.content });
            } else if (delta?.tool_calls) {
              onEvent?.({ type: 'tool_call', value: delta.tool_calls[0] });
            } else if (delta?.tool_output) {
              onEvent?.({ type: 'tool_output', value: delta.tool_output });
            }
          }
        } catch (e) {
          // ignore malformed lines
        }
      }
    }
  }
  return { content: assistant, responseId };
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

export async function editMessageApi(apiBase = defaultApiBase, conversationId: string, messageId: string, content: string) {
  const res = await fetch(`${apiBase}/v1/conversations/${conversationId}/messages/${messageId}/edit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return handleJSON(res) as Promise<{ message: { id: string; seq: number; content: string }; new_conversation_id: string }>;
}
