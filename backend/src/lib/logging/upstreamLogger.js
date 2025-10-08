import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';

const LOG_PREFIX = 'upstream-requests-';
const RESPONSE_LOG_PREFIX = 'upstream-responses-';
const SSE_RAW_LOG_PREFIX = 'upstream-responses-sse-raw-';
const RETENTION_DAYS = Number(process.env.UPSTREAM_LOG_RETENTION_DAYS || 7);

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

export function logUpstreamRequest({ url, headers, body }) {
  if (process.env.NODE_ENV === 'test') return;

  const logEntry = `[${new Date().toISOString()}] UPSTREAM REQUEST\n${JSON.stringify({
    url,
    method: 'POST',
    headers: { ...headers, Authorization: headers?.Authorization ? '[REDACTED]' : undefined },
    body: { ...body, tools: body?.tools ? '[OMITTED]' : undefined },
  }, null, 2)}\n\n`;

  try {
    cleanupOldLogs(LOG_DIR);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const filename = `${LOG_PREFIX}${dateStr}.log`;
    const filePath = path.join(LOG_DIR, filename);
    appendFileSync(filePath, logEntry);
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

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const dataContent = line.slice(6); // Remove 'data: ' prefix

      // Handle special cases
      if (dataContent === '[DONE]') {
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

        // Extract relevant fields for readability
        const delta = parsed.choices?.[0]?.delta;
        const finishReason = parsed.choices?.[0]?.finish_reason;
        const usage = parsed.usage;

        let chunkSummary = `[Chunk ${chunkIndex}]`;

        // Build summary with all available delta information
        const parts = [];
        if (delta?.role) {
          parts.push(`Role: ${delta.role}`);
        }
        if (delta?.content) {
          parts.push(`Content: ${JSON.stringify(delta.content)}`);
        }
        if (delta?.tool_calls) {
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
              parts.push(`Tool call streaming: ${toolNames}`);
              toolCallStreamingShown = true;
            }
          }
        }
        if (finishReason) {
          parts.push(`Finish reason: ${finishReason}`);
        }
        if (usage) {
          parts.push(`Usage: ${JSON.stringify(usage)}`);
        }

        if (parts.length > 0) {
          chunkSummary += ' ' + parts.join(', ');
          formattedChunks.push(chunkSummary);
          chunkIndex++;
        }
        // Skip empty chunks (common during tool call streaming)
      } catch {
        // If parsing fails, just show the raw line
        formattedChunks.push(`[Chunk ${chunkIndex}] (unparseable) ${dataContent}`);
        chunkIndex++;
      }
    } else if (line.trim()) {
      // Non-data lines (e.g., event:, id:, etc.)
      formattedChunks.push(`  ${line}`);
    }
  }

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
