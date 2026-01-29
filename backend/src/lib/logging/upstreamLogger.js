import { appendFileSync, mkdirSync, readdirSync, unlinkSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';

const LOG_PREFIX = 'upstream-requests-';
const RESPONSE_LOG_PREFIX = 'upstream-responses-';
const SSE_RAW_LOG_PREFIX = 'upstream-responses-sse-raw-';
const RETENTION_DAYS = Number(process.env.UPSTREAM_LOG_RETENTION_DAYS || 2);
const MAX_LOG_LINES = Number(process.env.UPSTREAM_LOG_MAX_LINES || 1000);

function resolveLogDir() {
  // In test environment, use a temporary directory to avoid polluting actual logs
  if (process.env.NODE_ENV === 'test') {
    const testLogDir = path.join(os.tmpdir(), 'chat-test-logs', `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    try {
      mkdirSync(testLogDir, { recursive: true });
      return testLogDir;
    } catch {
      return os.tmpdir();
    }
  }

  const candidates = [process.env.UPSTREAM_LOG_DIR, '/app/logs', path.join(process.cwd(), 'logs'), path.join(os.tmpdir(), 'chat-logs')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // try next
    }
  }
  return os.tmpdir();
}

function cleanupOldLogs(logDir) {
  try {
    const files = readdirSync(logDir);
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const prefixes = [LOG_PREFIX, RESPONSE_LOG_PREFIX, SSE_RAW_LOG_PREFIX];

    files.forEach((file) => {
      if (!file.endsWith('.log')) return;

      // Check if file matches any of our log prefixes
      const matchingPrefix = prefixes.find(prefix => file.startsWith(prefix));
      if (!matchingPrefix) return;

      const datePart = file.slice(matchingPrefix.length, -4); // strip prefix and .log
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;
      const fileDate = new Date(datePart);
      if (Number.isNaN(fileDate.getTime())) return;
      const ageDays = (now - fileDate.getTime()) / msPerDay;
      if (ageDays > RETENTION_DAYS) {
        try {
          unlinkSync(path.join(logDir, file));
        } catch (unlinkErr) {
          console.error('Failed to remove old log file:', file, unlinkErr.message);
        }
      }
    });
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to cleanup old log files:', err.message);
    }
  }
}

/**
 * Trim log file to keep only the last N lines (rolling cleanup)
 * @param {string} filePath - Full path to the log file
 * @param {number} maxLines - Maximum number of lines to keep
 */
function trimLogFile(filePath, maxLines) {
  try {
    // Check if file exists and has content
    const stats = statSync(filePath);
    if (stats.size === 0) return;

    // Read the entire file
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Only trim if we exceed the max line count
    if (lines.length > maxLines) {
      // Keep only the last maxLines lines
      const trimmedLines = lines.slice(-maxLines);
      const trimmedContent = trimmedLines.join('\n');

      // Write back to file
      writeFileSync(filePath, trimmedContent, 'utf8');
    }
  } catch (err) {
    // Silently ignore errors (file might not exist yet, which is fine)
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to trim log file:', filePath, err.message);
    }
  }
}

/**
 * Tee a Readable stream into a PassThrough that should be used by the consumer,
 * while capturing a bounded textual preview of the stream for logging.
 *
 * Usage:
 *   const { previewPromise, stream: loggedStream } = teeStreamWithPreview(originalReadable, { maxBytes: 64*1024 });
 *   // use loggedStream in place of originalReadable for downstream consumers
 *   // await previewPromise to get the captured string (truncated if needed)
 *
 * Notes:
 * - This function pipes the original readable into a PassThrough and returns that PassThrough;
 *   the consumer should read from the returned stream.
 * - The preview is captured by listening to the PassThrough 'data' events and is bounded by maxBytes.
 * - Errors on the original readable propagate to the preview promise.
 */
export function teeStreamWithPreview(readable, { maxBytes = 64 * 1024, encoding = 'utf8' } = {}) {
  if (!readable || typeof readable.pipe !== 'function') {
    // Not a stream; nothing to tee — return a resolved preview and the input as-is
    return { previewPromise: Promise.resolve(''), stream: readable };
  }

  const passthrough = new PassThrough();
  let preview = '';
  let settled = false;
  let resolvePreview;
  let rejectPreview;

  const previewPromise = new Promise((resolve, reject) => {
    resolvePreview = resolve;
    rejectPreview = reject;
  });

  function finalizePreview() {
    if (!settled) {
      settled = true;
      resolvePreview(preview);
    }
  }
  function failPreview(err) {
    if (!settled) {
      settled = true;
      rejectPreview(err);
    }
  }

  // Capture textual preview as data flows through the passthrough
  passthrough.on('data', (chunk) => {
    try {
      const s = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
      if (preview.length < maxBytes) {
        preview += s;
        if (preview.length > maxBytes) {
          preview = preview.slice(0, maxBytes) + '...[truncated]';
        }
      }
    } catch {
      // ignore preview errors
    }
  });

  passthrough.on('end', finalizePreview);
  passthrough.on('close', finalizePreview);
  passthrough.on('error', failPreview);
  readable.on('error', failPreview);

  // Pipe original readable into the passthrough that consumers will read from.
  // Piping will forward data and not consume the original elsewhere.
  readable.pipe(passthrough);

  return { previewPromise, stream: passthrough };
}

const LOG_DIR = resolveLogDir();

// Run periodic cleanup so old upstream logs don't linger without new requests.
if (process.env.NODE_ENV !== 'test') {
  cleanupOldLogs(LOG_DIR);
  const logCleanupTimer = setInterval(() => cleanupOldLogs(LOG_DIR), 24 * 60 * 60 * 1000);
  if (typeof logCleanupTimer.unref === 'function') {
    logCleanupTimer.unref();
  }
}

/**
 * Sanitize an object for logging by truncating base64 image data
 * @param {*} obj - The object to sanitize
 * @param {number} maxBase64Length - Maximum length of base64 data to keep
 * @returns {*} - The sanitized object
 */
function sanitizeForLogging(obj, maxBase64Length = 100) {
  if (typeof obj === 'string') {
    const match = obj.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (match) {
      const prefix = obj.slice(0, obj.indexOf(match[1]));
      const base64 = match[1];
      if (base64.length > maxBase64Length) {
        return prefix + base64.slice(0, maxBase64Length) + '...[truncated]';
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, maxBase64Length));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeForLogging(obj[key], maxBase64Length);
    }
    return sanitized;
  }
  return obj;
}

export function logUpstreamRequest({ url, headers, body }) {
  if (process.env.NODE_ENV === 'test') return;

  const logEntry = `[${new Date().toISOString()}] UPSTREAM REQUEST\n${JSON.stringify(
    {
      url,
      method: 'POST',
      headers: { ...headers, Authorization: headers?.Authorization ? '[REDACTED]' : undefined },
      body: sanitizeForLogging({ ...body, tools: body?.tools ? '[OMITTED]' : undefined }),
    },
    null,
    2
  )}\n\n`;

  try {
    cleanupOldLogs(LOG_DIR);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const filename = `${LOG_PREFIX}${dateStr}.log`;
    const filePath = path.join(LOG_DIR, filename);
    appendFileSync(filePath, logEntry);
    trimLogFile(filePath, MAX_LOG_LINES);
  } catch (err) {
    console.error('Failed to write to upstream log file:', err?.message || err);
  }
}

/**
 * Format SSE chunks for better readability
 * @param {string} bodyStr - The raw SSE stream body
 * @returns {string} - Formatted SSE chunks
 */
export function formatSSEChunks(bodyStr) {
  const lines = bodyStr.split('\n');
  const formattedChunks = [];
  let chunkIndex = 0;

  // Track accumulated tool call arguments across chunks
  const toolCallAccumulator = {};
  let toolCallStreamingShown = false;

  // Track consecutive content chunks to consolidate them
  let contentBuffer = [];
  let roleSet = false;

  // Track current event type for Realtime API format
  let currentEvent = null;

  function flushContentBuffer() {
    if (contentBuffer.length > 0) {
      const consolidatedContent = contentBuffer.join('');
      formattedChunks.push(`[Content] ${JSON.stringify(consolidatedContent)}`);
      contentBuffer = [];
    }
  }

  for (const line of lines) {
    // Skip OPENROUTER PROCESSING lines
    if (line === ': OPENROUTER PROCESSING') {
      continue;
    }

    // Handle event: lines (OpenAI Realtime API format)
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7); // Remove 'event: ' prefix
      continue;
    }

    if (line.startsWith('data: ')) {
      const dataContent = line.slice(6); // Remove 'data: ' prefix

      // Handle special cases
      if (dataContent === '[DONE]') {
        flushContentBuffer(); // Flush any pending content before showing tool calls

        // Show final accumulated tool calls if any
        if (Object.keys(toolCallAccumulator).length > 0) {
          formattedChunks.push('\n--- Accumulated Tool Calls ---');
          for (const [id, toolCall] of Object.entries(toolCallAccumulator)) {
            formattedChunks.push(`  Tool ${id}: ${toolCall.name}(${toolCall.arguments})`);
          }
        }
        formattedChunks.push(`\n[Chunk ${chunkIndex}] STREAM END`);
        continue;
      }

      try {
        const parsed = JSON.parse(dataContent);

        // Handle OpenAI Realtime API format
        if (currentEvent && parsed.type) {
          // Handle text deltas from Realtime API
          if (parsed.type === 'response.output_text.delta' && parsed.delta) {
            contentBuffer.push(parsed.delta);
            chunkIndex++;
            continue;
          }

          // Handle completion events
          if (parsed.type === 'response.output_text.done') {
            flushContentBuffer();
            if (parsed.text) {
              formattedChunks.push(`[Text Complete] Length: ${parsed.text.length} chars`);
            }
            chunkIndex++;
            continue;
          }

          // Handle response completion
          if (parsed.type === 'response.completed') {
            flushContentBuffer();
            const usage = parsed.response?.usage;
            if (usage) {
              formattedChunks.push(`[Response Complete] Usage: ${JSON.stringify(usage)}`);
            }
            chunkIndex++;
            continue;
          }

          // Skip other Realtime API event types to reduce noise
          if (parsed.type.startsWith('response.')) {
            continue;
          }
        }

        // Handle standard Chat Completions API format
        const delta = parsed.choices?.[0]?.delta;
        const finishReason = parsed.choices?.[0]?.finish_reason;
        const usage = parsed.usage;

        // Handle role separately (only once at the start)
        if (delta?.role && !roleSet) {
          flushContentBuffer(); // Flush any pending content before role
          formattedChunks.push(`[Chunk ${chunkIndex}] Role: ${delta.role}`);
          roleSet = true;
          chunkIndex++;
        }

        // Accumulate content chunks instead of logging individually
        if (delta?.content) {
          contentBuffer.push(delta.content);
          chunkIndex++; // Still count chunk index for debugging
        } else if (contentBuffer.length > 0) {
          // Flush content when we hit a non-content chunk
          flushContentBuffer();
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          flushContentBuffer(); // Flush content before tool calls

          // Accumulate tool call data instead of showing raw chunks
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0;
            if (!toolCallAccumulator[index]) {
              toolCallAccumulator[index] = {
                id: toolCall.id || `tool_${index}`,
                name: '',
                arguments: '',
              };
            }

            if (toolCall.id) {
              toolCallAccumulator[index].id = toolCall.id;
            }
            if (toolCall.function?.name) {
              toolCallAccumulator[index].name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              toolCallAccumulator[index].arguments += toolCall.function.arguments;
            }
          }

          // Only show "Tool call streaming..." for the first chunk that has tool names
          if (!toolCallStreamingShown) {
            const toolNames = Object.values(toolCallAccumulator)
              .filter(tc => tc.name)
              .map(tc => tc.name)
              .join(', ');
            if (toolNames) {
              formattedChunks.push(`[Chunk ${chunkIndex}] Tool call streaming: ${toolNames}`);
              toolCallStreamingShown = true;
              chunkIndex++;
            }
          }
        }

        // Handle finish_reason and usage
        if (finishReason || usage) {
          flushContentBuffer(); // Flush content before metadata
          const parts = [];
          if (finishReason) {
            parts.push(`Finish reason: ${finishReason}`);
          }
          if (usage) {
            parts.push(`Usage: ${JSON.stringify(usage)}`);
          }
          formattedChunks.push(`[Chunk ${chunkIndex}] ${parts.join(', ')}`);
          chunkIndex++;
        }
      } catch {
        flushContentBuffer(); // Flush content before unparseable chunk
        // If parsing fails, just show the raw line
        formattedChunks.push(`[Chunk ${chunkIndex}] (unparseable) ${dataContent}`);
        chunkIndex++;
      }
    }
    // Skip other SSE metadata lines to reduce noise
  }

  // Flush any remaining content at the end
  flushContentBuffer();

  return formattedChunks.join('\n');
}

export function logUpstreamResponse({ url, status, headers, body }) {
  if (process.env.NODE_ENV === 'test') return;

  const isEventStream = headers?.['content-type']?.includes('text/event-stream');

  // redact sensitive headers
  const safeHeaders = { ...headers, 'set-cookie': headers?.['set-cookie'] ? '[REDACTED]' : undefined };

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  let logEntry;
  if (isEventStream) {
    // For SSE we want to preserve raw "data: ..." lines rather than JSON-encoding them.
    // Expectation: caller passes a captured SSE string (or we coerce to string).
    const bodyStr = typeof body === 'string' ? body : (body == null ? '' : String(body));
    const meta = JSON.stringify({ url, status, headers: safeHeaders }, null, 2);

    // Format SSE chunks for better readability
    const formattedBody = formatSSEChunks(bodyStr);

    // Write formatted version to main log
    logEntry = `[${new Date().toISOString()}] UPSTREAM RESPONSE (event-stream)\n${meta}\n\nFormatted SSE Chunks:\n${formattedBody}\n\n`;

    // Write raw SSE stream to separate file for detailed debugging
    const rawLogEntry = `[${new Date().toISOString()}] UPSTREAM RESPONSE RAW SSE\n${meta}\n\n${bodyStr}\n\n`;
    try {
      const rawFilename = `${SSE_RAW_LOG_PREFIX}${dateStr}.log`;
      const rawFilePath = path.join(LOG_DIR, rawFilename);
      appendFileSync(rawFilePath, rawLogEntry);
      trimLogFile(rawFilePath, MAX_LOG_LINES);
    } catch (err) {
      console.error('Failed to write to upstream SSE raw log file:', err?.message || err);
    }
  } else {
    const logBody = JSON.stringify(body, null, 2);
    logEntry = `[${new Date().toISOString()}] UPSTREAM RESPONSE\n${JSON.stringify({
      url,
      status,
      headers: safeHeaders,
      body: logBody,
    }, null, 2)}\n\n`;
  }

  try {
    cleanupOldLogs(LOG_DIR);
    const filename = `${RESPONSE_LOG_PREFIX}${dateStr}.log`;
    const filePath = path.join(LOG_DIR, filename);
    appendFileSync(filePath, logEntry);
    trimLogFile(filePath, MAX_LOG_LINES);
  } catch (err) {
    console.error('Failed to write to upstream response log file:', err?.message || err);
  }
}

export default {
  logUpstreamRequest,
  logUpstreamResponse,
  teeStreamWithPreview,
  formatSSEChunks,
};
