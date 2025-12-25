import { getDb } from '../src/db/client.js';
import { insertMessageEvents } from '../src/db/messageEvents.js';
import { logger } from '../src/logger.js';

function extractTextFromMixedContent(content) {
  if (!Array.isArray(content)) return '';
  const segments = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      segments.push(part);
      continue;
    }
    if (typeof part === 'object') {
      if (typeof part.text === 'string') {
        segments.push(part.text);
        continue;
      }
      if (typeof part.value === 'string') {
        segments.push(part.value);
        continue;
      }
      if (typeof part.content === 'string') {
        segments.push(part.content);
      }
    }
  }
  return segments.join('');
}

function extractReasoningText(raw) {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((detail) => (typeof detail?.text === 'string' ? detail.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n');
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return parsed.text.trim();
    }
  } catch {
    return '';
  }
  return '';
}

function buildEvents({ contentText, reasoningText, toolCalls }) {
  const events = [];
  const hasThinkingInContent = contentText.includes('<thinking>');

  if (reasoningText && !hasThinkingInContent) {
    events.push({ type: 'reasoning', payload: { text: reasoningText } });
  }

  const callsWithOffsets = toolCalls
    .map((call) => ({
      id: call.id,
      index: call.call_index,
      offset: Number.isFinite(call.text_offset) ? call.text_offset : null,
    }))
    .sort((a, b) => {
      if (a.offset == null && b.offset == null) return (a.index ?? 0) - (b.index ?? 0);
      if (a.offset == null) return 1;
      if (b.offset == null) return -1;
      if (a.offset !== b.offset) return a.offset - b.offset;
      return (a.index ?? 0) - (b.index ?? 0);
    });

  let cursor = 0;
  for (const call of callsWithOffsets) {
    if (call.offset == null) continue;
    const normalized = Math.max(0, Math.min(call.offset, contentText.length));
    if (normalized > cursor) {
      const chunk = contentText.slice(cursor, normalized);
      if (chunk) events.push({ type: 'content', payload: { text: chunk } });
      cursor = normalized;
    }
    events.push({
      type: 'tool_call',
      payload: { tool_call_id: call.id, tool_call_index: call.index ?? 0 },
    });
  }

  if (cursor < contentText.length) {
    const remaining = contentText.slice(cursor);
    if (remaining) events.push({ type: 'content', payload: { text: remaining } });
  }

  for (const call of callsWithOffsets) {
    if (call.offset != null) continue;
    events.push({
      type: 'tool_call',
      payload: { tool_call_id: call.id, tool_call_index: call.index ?? 0 },
    });
  }

  if (events.length === 0 && contentText) {
    events.push({ type: 'content', payload: { text: contentText } });
  }

  return events;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    limit: (() => {
      const match = process.argv.find((arg) => arg.startsWith('--limit='));
      if (!match) return null;
      const value = Number(match.split('=')[1]);
      return Number.isFinite(value) ? value : null;
    })(),
  };
}

function main() {
  const { dryRun, limit } = parseArgs();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.content, m.content_json, m.reasoning_details
       FROM messages m
       WHERE m.role = 'assistant'
         AND m.status IN ('final', 'error')
         AND NOT EXISTS (
           SELECT 1 FROM message_events e WHERE e.message_id = m.id
         )
       ORDER BY m.id ASC
       ${limit ? 'LIMIT @limit' : ''}`
    )
    .all(limit ? { limit } : {});

  let processed = 0;
  let inserted = 0;

  const toolCallsStmt = db.prepare(
    `SELECT id, call_index, text_offset
     FROM tool_calls
     WHERE message_id = @messageId
     ORDER BY call_index ASC`
  );

  for (const row of rows) {
    processed += 1;
    let contentText = typeof row.content === 'string' ? row.content : '';

    if (row.content_json) {
      try {
        const parsed = JSON.parse(row.content_json);
        contentText = extractTextFromMixedContent(parsed);
      } catch {
        contentText = typeof row.content === 'string' ? row.content : '';
      }
    }

    const reasoningText = extractReasoningText(row.reasoning_details);
    const toolCalls = toolCallsStmt.all({ messageId: row.id });
    const events = buildEvents({ contentText, reasoningText, toolCalls });

    if (events.length === 0) continue;
    inserted += 1;

    if (!dryRun) {
      insertMessageEvents({
        messageId: row.id,
        conversationId: row.conversation_id,
        events: events.map((event, index) => ({ ...event, seq: index })),
      });
    }
  }

  logger.info('[backfill-message-events] completed', {
    processed,
    inserted,
    dryRun,
  });
}

main();
