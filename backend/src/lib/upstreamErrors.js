const UNKNOWN_UPSTREAM_ERROR = {
  error: 'upstream_error',
  message: 'Unknown error',
};

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractSSEPayloads(text) {
  const payloads = [];
  const lines = text.split(/\r?\n/);
  let currentPayload = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      currentPayload.push(line.slice(5).trimStart());
      continue;
    }

    if (!line.trim()) {
      if (currentPayload.length > 0) {
        payloads.push(currentPayload.join('\n').trim());
        currentPayload = [];
      }
    }
  }

  if (currentPayload.length > 0) {
    payloads.push(currentPayload.join('\n').trim());
  }

  return payloads.filter(Boolean);
}

function parseSSEErrorBody(text) {
  const payloads = extractSSEPayloads(text);

  for (const payload of payloads) {
    if (!payload || payload === '[DONE]') continue;

    const parsed = tryParseJson(payload);
    if (parsed !== undefined) {
      return parsed;
    }

    return {
      error: 'upstream_error',
      message: payload,
    };
  }

  return undefined;
}

export async function readUpstreamErrorBody(upstream) {
  let text;

  try {
    text = await upstream.text();
  } catch {
    return { ...UNKNOWN_UPSTREAM_ERROR };
  }

  if (typeof text !== 'string') {
    return { ...UNKNOWN_UPSTREAM_ERROR };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return { ...UNKNOWN_UPSTREAM_ERROR };
  }

  const parsedJson = tryParseJson(trimmedText);
  if (parsedJson !== undefined) {
    return parsedJson;
  }

  const parsedSse = parseSSEErrorBody(trimmedText);
  if (parsedSse !== undefined) {
    return parsedSse;
  }

  return {
    error: 'upstream_error',
    message: trimmedText,
  };
}

/**
 * Extract a human-readable error message from various upstream response formats.
 * Handles OpenAI, Anthropic, Gemini, SSE-wrapped, and generic provider error structures.
 */
export function extractUpstreamMessage(body) {
  if (typeof body === 'string') {
    const message = body.trim();
    return message || undefined;
  }

  if (Array.isArray(body) && body.length > 0) {
    const first = body[0];
    if (first && typeof first === 'object') {
      if (typeof first.message === 'string') {
        return first.message;
      }
      if (first.error && typeof first.error === 'object' && typeof first.error.message === 'string') {
        return first.error.message;
      }
    }
  }

  if (!body || typeof body !== 'object') {
    return undefined;
  }

  if (typeof body.message === 'string') {
    return body.message;
  }

  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') {
    return body.error.message;
  }

  if (typeof body.error === 'string') {
    return body.error;
  }

  return undefined;
}