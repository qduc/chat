import { getDb } from './client.js';
import { logger } from '../logger.js';
import { getMessageEventsByMessageIds } from './messageEvents.js';
import { getBranchHeadMessageId, updateConversationBranchHead } from './branches.js';

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

function normalizeMessageContent(content) {
  if (Array.isArray(content)) {
    return {
      textContent: extractTextFromMixedContent(content),
      jsonContent: JSON.stringify(content),
    };
  }

  if (typeof content === 'string') {
    return { textContent: content, jsonContent: null };
  }

  if (content && typeof content === 'object') {
    try {
      return {
        textContent: '',
        jsonContent: JSON.stringify(content),
      };
    } catch {
      return { textContent: '', jsonContent: null };
    }
  }

  return { textContent: '', jsonContent: null };
}

function normalizeReasoningDetails(details) {
  if (details === undefined) return undefined;
  if (details === null) return null;
  return details;
}

function normalizeReasoningTokens(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, Math.trunc(asNumber));
}

function normalizeTokenCount(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, Math.trunc(asNumber));
}

function normalizeTiming(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, asNumber);
}

function parseJsonField(raw, messageId, fieldName) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.warn(`Failed to parse ${fieldName} for message ${messageId}`, error);
    return null;
  }
}

function parseMetadataJson(raw, messageId) {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    logger.warn(`Failed to parse metadata_json for message ${messageId}`, error);
    return null;
  }
}

function setOrDeleteField(target, key, value) {
  if (value === undefined) return;
  if (value === null) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function buildMetadataJson({
  existing = null,
  finishReason,
  responseId,
  provider,
  reasoningDetails,
  reasoningTokens,
  tokensIn,
  tokensOut,
  totalTokens,
  promptMs,
  completionMs,
}) {
  const metadata = existing && typeof existing === 'object' ? { ...existing } : {};
  const usage = metadata.usage && typeof metadata.usage === 'object' ? { ...metadata.usage } : {};

  setOrDeleteField(metadata, 'finish_reason', finishReason);
  setOrDeleteField(metadata, 'response_id', responseId);
  setOrDeleteField(metadata, 'provider', provider);

  if (reasoningDetails !== undefined) {
    setOrDeleteField(metadata, 'reasoning_details', reasoningDetails);
  }

  setOrDeleteField(usage, 'prompt_tokens', tokensIn);
  setOrDeleteField(usage, 'completion_tokens', tokensOut);
  setOrDeleteField(usage, 'total_tokens', totalTokens);
  setOrDeleteField(usage, 'reasoning_tokens', reasoningTokens);
  setOrDeleteField(usage, 'prompt_ms', promptMs);
  setOrDeleteField(usage, 'completion_ms', completionMs);

  if (Object.keys(usage).length > 0) {
    metadata.usage = usage;
  } else if (
    tokensIn !== undefined ||
    tokensOut !== undefined ||
    totalTokens !== undefined ||
    reasoningTokens !== undefined ||
    promptMs !== undefined ||
    completionMs !== undefined
  ) {
    delete metadata.usage;
  }

  if (Object.keys(metadata).length === 0) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

function resolveConversationBranchId(conversationId, branchId = null) {
  if (branchId) return branchId;
  const db = getDb();
  const row = db.prepare(`
    SELECT active_branch_id
    FROM conversations
    WHERE id = @conversationId
      AND deleted_at IS NULL
  `).get({ conversationId });
  return row?.active_branch_id || null;
}

function resolveInsertBranchContext({ conversationId, branchId = null, parentMessageId = undefined }) {
  const resolvedBranchId = resolveConversationBranchId(conversationId, branchId);
  const resolvedParentMessageId = parentMessageId === undefined
    ? getBranchHeadMessageId({ branchId: resolvedBranchId })
    : parentMessageId;

  return {
    branchId: resolvedBranchId,
    parentMessageId: resolvedParentMessageId ?? null,
  };
}

function getActiveTimelineQuery() {
  return `
    WITH RECURSIVE timeline(id, parent_message_id, depth) AS (
      SELECT m.id, m.parent_message_id, 0
      FROM conversation_branches b
      JOIN messages m ON m.id = b.head_message_id
      WHERE b.conversation_id = @conversationId
        AND b.id = @branchId
        AND b.archived_at IS NULL

      UNION ALL

      SELECT parent.id, parent.parent_message_id, timeline.depth + 1
      FROM messages parent
      JOIN timeline ON timeline.parent_message_id = parent.id
      WHERE timeline.depth < 5000
    )
  `;
}

export function getNextSeq(conversationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM messages WHERE conversation_id=@conversationId`
    )
    .get({ conversationId });
  return row?.nextSeq || 1;
}

export function countMessagesByConversation(conversationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(1) as c FROM messages WHERE conversation_id=@conversationId`
    )
    .get({ conversationId });
  return row?.c || 0;
}

export function insertUserMessage({
  conversationId,
  content,
  seq,
  clientMessageId = null,
  branchId = null,
  parentMessageId = undefined,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const branchContext = resolveInsertBranchContext({ conversationId, branchId, parentMessageId });

  // Handle mixed content (array) or plain text (string)
  let textContent = '';
  let jsonContent = null;

  if (Array.isArray(content)) {
    // Mixed content format: extract text and store full JSON
    jsonContent = JSON.stringify(content);
    // Extract text parts for the content column (backward compatibility)
    textContent = content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
  } else {
    // Plain text format
    textContent = content || '';
  }

  const info = db
    .prepare(
      `INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        content_json,
        seq,
        parent_message_id,
        client_message_id,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        'user',
        'final',
        @content,
        @contentJson,
        @seq,
        @parentMessageId,
        @clientMessageId,
        @now,
        @now
      )`
    )
    .run({
      conversationId,
      branchId: branchContext.branchId,
      content: textContent,
      contentJson: jsonContent,
      seq,
      parentMessageId: branchContext.parentMessageId,
      clientMessageId,
      now
    });
  updateConversationBranchHead({ branchId: branchContext.branchId, headMessageId: info.lastInsertRowid, conversationId });
  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function createAssistantDraft({
  conversationId,
  seq,
  clientMessageId = null,
  branchId = null,
  parentMessageId = undefined,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const branchContext = resolveInsertBranchContext({ conversationId, branchId, parentMessageId });
  const info = db
    .prepare(
      `INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        seq,
        parent_message_id,
        client_message_id,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        'assistant',
        'streaming',
        '',
        @seq,
        @parentMessageId,
        @clientMessageId,
        @now,
        @now
      )`
    )
    .run({
      conversationId,
      branchId: branchContext.branchId,
      seq,
      parentMessageId: branchContext.parentMessageId,
      clientMessageId,
      now,
    });
  updateConversationBranchHead({ branchId: branchContext.branchId, headMessageId: info.lastInsertRowid, conversationId });
  return { id: info.lastInsertRowid, seq };
}

export function appendAssistantContent({ messageId, delta }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET content = COALESCE(content,'') || @delta, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, delta: delta || '', now });
}

export function finalizeAssistantMessage({
  messageId,
  finishReason = null,
  status = 'final',
  responseId = null,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT metadata_json FROM messages WHERE id = @messageId`)
    .get({ messageId });
  const metadata = parseMetadataJson(existing?.metadata_json, messageId);
  const metadataJson = buildMetadataJson({
    existing: metadata,
    finishReason,
    responseId,
  });
  db.prepare(
    `UPDATE messages SET status=@status, metadata_json=@metadataJson, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, status, metadataJson, now });
}

export function markAssistantError({ messageId }) {
  finalizeAssistantMessage({
    messageId,
    finishReason: 'error',
    status: 'error',
  });
}

export function insertAssistantFinal({
  conversationId,
  content,
  seq,
  finishReason = 'stop',
  responseId = null,
  reasoningDetails = undefined,
  reasoningTokens = undefined,
  tokensIn = undefined,
  tokensOut = undefined,
  totalTokens = undefined,
  promptMs = undefined,
  completionMs = undefined,

  provider = undefined,
  clientMessageId = null,
  branchId = null,
  parentMessageId = undefined,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const branchContext = resolveInsertBranchContext({ conversationId, branchId, parentMessageId });

  const { textContent, jsonContent } = normalizeMessageContent(content);
  const normalizedReasoning = normalizeReasoningDetails(reasoningDetails);
  const normalizedTokens = normalizeReasoningTokens(reasoningTokens);
  const normalizedTokensIn = normalizeTokenCount(tokensIn);
  const normalizedTokensOut = normalizeTokenCount(tokensOut);
  const normalizedTotalTokens = normalizeTokenCount(totalTokens);
  const normalizedPromptMs = normalizeTiming(promptMs);
  const normalizedCompletionMs = normalizeTiming(completionMs);
  const metadataJson = buildMetadataJson({
    finishReason,
    responseId,
    provider,
    reasoningDetails: normalizedReasoning,
    reasoningTokens: normalizedTokens,
    tokensIn: normalizedTokensIn,
    tokensOut: normalizedTokensOut,
    totalTokens: normalizedTotalTokens,
    promptMs: normalizedPromptMs,
    completionMs: normalizedCompletionMs,
  });

  const info = db
    .prepare(
      `INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        content_json,
        seq,
        parent_message_id,
        metadata_json,
        client_message_id,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        'assistant',
        'final',
        @content,
        @contentJson,
        @seq,
        @parentMessageId,
        @metadataJson,
        @clientMessageId,
        @now,
        @now
      )`
    )
    .run({
      conversationId,
      branchId: branchContext.branchId,
      content: textContent || '',
      contentJson: jsonContent,
      seq,
      parentMessageId: branchContext.parentMessageId,
      metadataJson,
      clientMessageId,
      now,
    });
  updateConversationBranchHead({ branchId: branchContext.branchId, headMessageId: info.lastInsertRowid, conversationId });
  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function insertToolMessage({
  conversationId,
  content,
  seq,
  status = 'success',
  clientMessageId = null,
  branchId = null,
  parentMessageId = undefined,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const branchContext = resolveInsertBranchContext({ conversationId, branchId, parentMessageId });
  const info = db
    .prepare(
      `INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        seq,
        parent_message_id,
        client_message_id,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        'tool',
        @status,
        @content,
        @seq,
        @parentMessageId,
        @clientMessageId,
        @now,
        @now
      )`
    )
    .run({
      conversationId,
      branchId: branchContext.branchId,
      status,
      content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      seq,
      parentMessageId: branchContext.parentMessageId,
      clientMessageId,
      now
    });

  updateConversationBranchHead({ branchId: branchContext.branchId, headMessageId: info.lastInsertRowid, conversationId });
  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function markAssistantErrorBySeq({
  conversationId,
  seq,
  branchId = null,
  parentMessageId = undefined,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const metadataJson = buildMetadataJson({ finishReason: 'error' });
  const branchContext = resolveInsertBranchContext({ conversationId, branchId, parentMessageId });
  const info = db
    .prepare(
      `INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        seq,
        parent_message_id,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        'assistant',
        'error',
        '',
        @seq,
        @parentMessageId,
        @metadataJson,
        @now,
        @now
      )`
    )
    .run({
      conversationId,
      branchId: branchContext.branchId,
      seq,
      parentMessageId: branchContext.parentMessageId,
      metadataJson,
      now,
    });
  updateConversationBranchHead({ branchId: branchContext.branchId, headMessageId: info.lastInsertRowid, conversationId });
  return { id: info.lastInsertRowid, seq };
}

/**
 * Fetches a paginated list of messages from a conversation, with optional metadata
 * such as tool calls and outputs attached to each message.
 *
 * @param {Object} options - The options for fetching the messages page.
 * @param {string} options.conversationId - The unique identifier of the conversation.
 * @param {number} [options.afterSeq=0] - The sequence number after which messages will be fetched.
 * @param {number} [options.limit=50] - The maximum number of messages to fetch. The value is clamped between 1 and 200.
 * @return {Object} An object containing the fetched messages and pagination metadata.
 * @return {Array<Object>} return.messages - The list of messages retrieved, each containing various attributes and related metadata.
 * @return {number|null} return.next_after_seq - The sequence number for fetching further messages, or null if no further messages are available.
 */
export function getMessagesPage({ conversationId, branchId: requestedBranchId = null, afterSeq = 0, limit = 50 }) {
  const db = getDb();
  const sanitizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const branchId = resolveConversationBranchId(conversationId, requestedBranchId);
  if (!branchId) {
    return { messages: [], next_after_seq: null };
  }
  const messages = db
    .prepare(
      `${getActiveTimelineQuery()}
       SELECT
         m.id,
         m.branch_id,
         m.parent_message_id,
         m.seq,
         m.role,
         m.status,
         m.content,
         m.content_json,
         m.metadata_json,
         m.client_message_id,
         m.created_at
      FROM timeline t
      JOIN messages m ON m.id = t.id
      WHERE m.seq > @afterSeq
      ORDER BY t.depth DESC
      LIMIT @limit`
    )
    .all({ conversationId, branchId, afterSeq, limit: sanitizedLimit });

  // Build mapping of integer id to client_message_id before transformation
  const integerIdToClientId = new Map();
  for (const message of messages) {
    if (message.client_message_id) {
      integerIdToClientId.set(message.id, message.client_message_id);
    }
  }

  // Parse content_json and use it if available, otherwise fall back to content
  for (const message of messages) {
    if (message.content_json) {
      const parsedContent = parseJsonField(message.content_json, message.id, 'content_json');
      if (parsedContent !== null) {
        message.content = parsedContent;
      }
    }
    delete message.content_json;

    const metadata = parseMetadataJson(message.metadata_json, message.id) || {};
    const usage = metadata.usage && typeof metadata.usage === 'object' ? metadata.usage : null;

    if (Array.isArray(metadata.reasoning_details)) {
      message.reasoning_details = metadata.reasoning_details;
    } else {
      message.reasoning_details = null;
    }

    if (metadata.provider != null) {
      message.provider = metadata.provider;
    }

    if (metadata.response_id != null) {
      message.response_id = metadata.response_id;
    }

    const promptTokens =
      usage?.prompt_tokens != null ? Number(usage.prompt_tokens) : null;
    const completionTokens =
      usage?.completion_tokens != null ? Number(usage.completion_tokens) : null;
    const reasoningTokens =
      usage?.reasoning_tokens != null ? Number(usage.reasoning_tokens) : null;
    const totalTokens =
      usage?.total_tokens != null
        ? Number(usage.total_tokens)
        : (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);
    const promptMs = usage?.prompt_ms != null ? Number(usage.prompt_ms) : null;
    const completionMs = usage?.completion_ms != null ? Number(usage.completion_ms) : null;

    if (
      promptTokens != null ||
      completionTokens != null ||
      totalTokens != null ||
      reasoningTokens != null ||
      promptMs != null ||
      completionMs != null
    ) {
      message.usage = {
        ...(promptTokens != null ? { prompt_tokens: promptTokens } : {}),
        ...(completionTokens != null ? { completion_tokens: completionTokens } : {}),
        ...(totalTokens != null ? { total_tokens: totalTokens } : {}),
        ...(reasoningTokens != null ? { reasoning_tokens: reasoningTokens } : {}),
        ...(promptMs != null ? { prompt_ms: promptMs } : {}),
        ...(completionMs != null ? { completion_ms: completionMs } : {}),
      };
    }

    delete message.metadata_json;
  }

  // Fetch tool calls and outputs for all messages in batch (using integer IDs)
  if (messages.length > 0) {
    const messageIds = messages.map(m => m.id);
    const placeholders = messageIds.map(() => '?').join(',');
    const messageEventsByMessage = getMessageEventsByMessageIds(messageIds);

    // Get all tool calls for these messages
    const toolCalls = db
      .prepare(
        `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
         FROM tool_calls
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, call_index ASC`
      )
      .all(...messageIds);

    // Get all tool outputs for these messages
    const toolOutputs = db
      .prepare(
        `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
         FROM tool_outputs
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, executed_at ASC`
      )
      .all(...messageIds);

    // Group tool calls by message_id
    const toolCallsByMessage = {};
    for (const tc of toolCalls) {
      if (!toolCallsByMessage[tc.message_id]) {
        toolCallsByMessage[tc.message_id] = [];
      }
      // Transform to OpenAI format
      toolCallsByMessage[tc.message_id].push({
        id: tc.id,
        type: 'function',
        index: tc.call_index,
        function: {
          name: tc.tool_name,
          arguments: tc.arguments
        },
        textOffset: tc.text_offset
      });
    }

    // Group tool outputs by message_id
    const toolOutputsByMessage = {};
    for (const to of toolOutputs) {
      if (!toolOutputsByMessage[to.message_id]) {
        toolOutputsByMessage[to.message_id] = [];
      }
      // Transform to expected format
      toolOutputsByMessage[to.message_id].push({
        tool_call_id: to.tool_call_id,
        output: to.output,
        status: to.status
      });
    }

    // Attach tool calls and outputs to messages (still using integer IDs)
    for (const message of messages) {
      if (messageEventsByMessage[message.id]) {
        message.message_events = messageEventsByMessage[message.id];
      }
      if (toolCallsByMessage[message.id]) {
        message.tool_calls = toolCallsByMessage[message.id];
      }
      if (toolOutputsByMessage[message.id]) {
        if (message.role === 'tool') {
          const [firstOutput] = toolOutputsByMessage[message.id];
          if (firstOutput) {
            message.tool_call_id = firstOutput.tool_call_id;
            message.status = firstOutput.status || message.status;
            message.tool_outputs = [{
              tool_call_id: firstOutput.tool_call_id,
              output: firstOutput.output,
              status: firstOutput.status
            }];
          }
        } else {
          message.tool_outputs = toolOutputsByMessage[message.id];
        }
      }
    }
  }

  // Finally, transform integer IDs to client_message_ids for API response
  // Store integer ID as _dbId for internal use (like updates/deletes)
  for (const message of messages) {
    message._dbId = message.id; // Store integer ID for database operations
    message._parentMessageId = message.parent_message_id;
    if (message.client_message_id) {
      message.id = message.client_message_id;
    }
    delete message.parent_message_id;
    delete message.client_message_id;
  }

  const next_after_seq =
    messages.length === sanitizedLimit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}

export function getActiveBranchMessages({ conversationId, afterSeq = 0, limit = 200 }) {
  return getMessagesPage({ conversationId, afterSeq, limit });
}

export function getLastMessage({ conversationId }) {
  const db = getDb();
  const branchId = resolveConversationBranchId(conversationId);
  if (!branchId) return null;
  const message = db
    .prepare(
      `${getActiveTimelineQuery()}
       SELECT
         m.id,
         m.branch_id,
         m.parent_message_id,
         m.seq,
         m.role,
         m.status,
         m.content,
         m.content_json,
         m.metadata_json,
         m.client_message_id,
         m.created_at
      FROM timeline t
      JOIN messages m ON m.id = t.id
      ORDER BY t.depth ASC
      LIMIT 1`
    )
    .get({ conversationId, branchId });

  if (!message) return null;

  // Store integer ID for database lookups
  const integerMessageId = message.id;

  // Parse content_json and use it if available, otherwise fall back to content
  if (message.content_json) {
    const parsedContent = parseJsonField(message.content_json, message.id, 'content_json');
    if (parsedContent !== null) {
      message.content = parsedContent;
    }
  }
  // Remove content_json from response (internal field)
  delete message.content_json;

  const metadata = parseMetadataJson(message.metadata_json, message.id) || {};
  const usage = metadata.usage && typeof metadata.usage === 'object' ? metadata.usage : null;

  if (Array.isArray(metadata.reasoning_details)) {
    message.reasoning_details = metadata.reasoning_details;
  } else {
    message.reasoning_details = null;
  }

  if (metadata.provider != null) {
    message.provider = metadata.provider;
  }

  if (metadata.response_id != null) {
    message.response_id = metadata.response_id;
  }

  const promptTokens =
    usage?.prompt_tokens != null ? Number(usage.prompt_tokens) : null;
  const completionTokens =
    usage?.completion_tokens != null ? Number(usage.completion_tokens) : null;
  const reasoningTokens =
    usage?.reasoning_tokens != null ? Number(usage.reasoning_tokens) : null;
  const totalTokens =
    usage?.total_tokens != null
      ? Number(usage.total_tokens)
      : (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);
    const promptMs = usage?.prompt_ms != null ? Number(usage.prompt_ms) : null;
    const completionMs = usage?.completion_ms != null ? Number(usage.completion_ms) : null;

    if (
      promptTokens != null ||
      completionTokens != null ||
      totalTokens != null ||
      reasoningTokens != null ||
      promptMs != null ||
      completionMs != null
    ) {
      message.usage = {
        ...(promptTokens != null ? { prompt_tokens: promptTokens } : {}),
        ...(completionTokens != null ? { completion_tokens: completionTokens } : {}),
        ...(totalTokens != null ? { total_tokens: totalTokens } : {}),
        ...(reasoningTokens != null ? { reasoning_tokens: reasoningTokens } : {}),
        ...(promptMs != null ? { prompt_ms: promptMs } : {}),
        ...(completionMs != null ? { completion_ms: completionMs } : {}),
      };
    }

    delete message.metadata_json;

  // Fetch tool calls for this message (using integer ID)
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE message_id = @messageId
       ORDER BY call_index ASC`
    )
    .all({ messageId: integerMessageId });

  // Fetch tool outputs for this message (using integer ID)
  const toolOutputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE message_id = @messageId
       ORDER BY executed_at ASC`
    )
    .all({ messageId: integerMessageId });

  const messageEventsByMessage = getMessageEventsByMessageIds([integerMessageId]);
  if (messageEventsByMessage[integerMessageId]) {
    message.message_events = messageEventsByMessage[integerMessageId];
  }

  // Transform tool calls to OpenAI format
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      index: tc.call_index,
      function: {
        name: tc.tool_name,
        arguments: tc.arguments
      },
      textOffset: tc.text_offset
    }));
  }

  // Transform tool outputs to expected format
  if (toolOutputs.length > 0) {
    message.tool_outputs = toolOutputs.map(to => ({
      tool_call_id: to.tool_call_id,
      output: to.output,
      status: to.status
    }));
  }

  // Finally, transform integer ID to client_message_id for API response
  // Store integer ID as _dbId for internal use (like updates/deletes)
  message._dbId = message.id; // Store integer ID for database operations
  message._parentMessageId = message.parent_message_id;
  if (message.client_message_id) {
    message.id = message.client_message_id;
  }
  delete message.parent_message_id;
  delete message.client_message_id;

  return message;
}

export function getLastAssistantResponseId({ conversationId }) {
  const db = getDb();
  const branchId = resolveConversationBranchId(conversationId);
  if (!branchId) return null;
  const rows = db
    .prepare(
      `${getActiveTimelineQuery()}
       SELECT m.metadata_json, m.id
       FROM timeline t
       JOIN messages m ON m.id = t.id
       WHERE m.role = 'assistant'
         AND m.metadata_json IS NOT NULL
       ORDER BY t.depth ASC
       LIMIT 25`
    )
    .all({ conversationId, branchId });

  for (const row of rows) {
    const metadata = parseMetadataJson(row.metadata_json, row.id);
    if (metadata?.response_id) {
      return metadata.response_id;
    }
  }

  return null;
}

export function getMessageByClientId({ conversationId, clientMessageId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT m.id, m.conversation_id, m.branch_id, m.parent_message_id, m.role, m.seq, m.client_message_id
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE (m.client_message_id = @clientMessageId OR CAST(m.id AS TEXT) = @clientMessageId)
       AND c.id = @conversationId
       AND c.deleted_at IS NULL
       AND c.user_id = @userId`;

  return db.prepare(query).get({ clientMessageId, conversationId, userId });
}

function hydrateMessageContentRow(row) {
  if (!row) return null;
  if (row.content_json) {
    const parsedContent = parseJsonField(row.content_json, row.id, 'content_json');
    if (parsedContent !== null) {
      row.content = parsedContent;
    }
  }
  delete row.content_json;
  return row;
}

export function getMessageContentByClientId({ conversationId, clientMessageId, userId, branchId = null }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  if (branchId) {
    // Restrict lookup to messages visible on the specified branch timeline only
    const query = `${getActiveTimelineQuery()}
       SELECT m.id, m.conversation_id, m.branch_id, m.parent_message_id, m.role, m.seq, m.content, m.content_json, m.client_message_id
       FROM timeline t
       JOIN messages m ON m.id = t.id
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (m.client_message_id = @clientMessageId OR CAST(m.id AS TEXT) = @clientMessageId)
         AND c.id = @conversationId
         AND c.deleted_at IS NULL
         AND c.user_id = @userId
       LIMIT 1`;
    const row = db.prepare(query).get({ conversationId, branchId, clientMessageId, userId });
    return hydrateMessageContentRow(row);
  }

  const query = `SELECT m.id, m.conversation_id, m.branch_id, m.parent_message_id, m.role, m.seq, m.content, m.content_json, m.client_message_id
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE (m.client_message_id = @clientMessageId OR CAST(m.id AS TEXT) = @clientMessageId)
       AND c.id = @conversationId
       AND c.deleted_at IS NULL
       AND c.user_id = @userId`;

  const row = db.prepare(query).get({ clientMessageId, conversationId, userId });
  return hydrateMessageContentRow(row);
}

export function getPreviousUserMessage({ conversationId, beforeSeq, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const branchId = resolveConversationBranchId(conversationId);
  if (!branchId) return null;
  const query = `${getActiveTimelineQuery()}
     SELECT m.id, m.conversation_id, m.branch_id, m.parent_message_id, m.role, m.seq, m.content, m.content_json
     FROM timeline t
     JOIN messages m ON m.id = t.id
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.role = 'user'
       AND m.seq < @beforeSeq
       AND c.deleted_at IS NULL
       AND c.user_id = @userId
     ORDER BY t.depth ASC
     LIMIT 1`;

  const row = db.prepare(query).get({ conversationId, branchId, beforeSeq, userId });
  return hydrateMessageContentRow(row);
}

export function updateMessageContent({
  messageId,
  conversationId,
  userId,
  content,
  status,
  reasoningDetails,
  reasoningTokens,
  tokensIn,
  tokensOut,
  totalTokens,
  promptMs,
  completionMs,
  finishReason,
  responseId,
  provider,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  const query = `SELECT m.id, m.conversation_id, m.role, m.seq
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = @messageId AND c.id = @conversationId AND c.deleted_at IS NULL AND c.user_id = @userId`;

  const message = db.prepare(query).get({ messageId, conversationId, userId });

  if (!message) return null;

  const { textContent, jsonContent } = normalizeMessageContent(content);
  const normalizedReasoning = normalizeReasoningDetails(reasoningDetails);
  const normalizedTokens = normalizeReasoningTokens(reasoningTokens);
  const normalizedTokensIn = normalizeTokenCount(tokensIn);
  const normalizedTokensOut = normalizeTokenCount(tokensOut);
  const normalizedTotalTokens = normalizeTokenCount(totalTokens);
  const normalizedPromptMs = normalizeTiming(promptMs);
  const normalizedCompletionMs = normalizeTiming(completionMs);

  const existingMetadataRow = db
    .prepare(`SELECT metadata_json FROM messages WHERE id = @messageId`)
    .get({ messageId });
  const existingMetadata = parseMetadataJson(existingMetadataRow?.metadata_json, messageId);
  const metadataJson = buildMetadataJson({
    existing: existingMetadata,
    finishReason,
    responseId,
    provider,
    reasoningDetails: normalizedReasoning,
    reasoningTokens: normalizedTokens,
    tokensIn: normalizedTokensIn,
    tokensOut: normalizedTokensOut,
    totalTokens: normalizedTotalTokens,
    promptMs: normalizedPromptMs,
    completionMs: normalizedCompletionMs,
  });

  const updates = ['content = @content', 'content_json = @contentJson', 'metadata_json = @metadataJson', 'updated_at = @now'];
  const params = {
    messageId,
    content: textContent,
    contentJson: jsonContent,
    metadataJson,
    now,
  };

  if (status !== undefined) {
    updates.push('status = @status');
    params.status = status;
  }

  const updateSql = `UPDATE messages SET ${updates.join(', ')} WHERE id = @messageId`;

  db.prepare(updateSql).run(params);

  return message;
}

export function deleteMessagesAfterSeq({ conversationId, userId, afterSeq }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  const query = `SELECT id FROM conversations WHERE id = @conversationId AND deleted_at IS NULL AND user_id = @userId`;
  const conversation = db.prepare(query).get({ conversationId, userId });

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId AND seq > @afterSeq`
  ).run({ conversationId, afterSeq });

  return result.changes > 0;
}

export function clearAllMessages({ conversationId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  const query = `SELECT id FROM conversations WHERE id = @conversationId AND user_id = @userId AND deleted_at IS NULL`;
  const conversation = db.prepare(query).get({ conversationId, userId });

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId`
  ).run({ conversationId });

  return result.changes > 0;
}

export function getAllMessagesForSync({ conversationId, branchId = null }) {
  const allMessages = [];
  let afterSeq = 0;

  while (true) {
    const page = getMessagesPage({ conversationId, branchId, afterSeq, limit: 200 });
    const pageMessages = page?.messages || [];

    allMessages.push(...pageMessages);

    if (!page?.next_after_seq) break;
    afterSeq = page.next_after_seq;
  }

  return allMessages;
}
