import { getDb } from './client.js';
import { logger } from '../logger.js';

let messageEventsTableAvailable = null;

function isMessageEventsTableAvailable(db) {
  if (messageEventsTableAvailable !== null) return messageEventsTableAvailable;
  try {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='message_events'`
    ).get();
    messageEventsTableAvailable = Boolean(row?.name);
  } catch (error) {
    logger.warn('[messageEvents] Failed to check table availability', error);
    messageEventsTableAvailable = false;
  }
  return messageEventsTableAvailable;
}

function serializePayload(payload) {
  if (payload === undefined) return null;
  if (payload === null) return null;
  try {
    return JSON.stringify(payload);
  } catch (error) {
    logger.warn('[messageEvents] Failed to serialize payload', error);
    return null;
  }
}

function parsePayload(raw, eventId) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.warn(`[messageEvents] Failed to parse payload for event ${eventId}`, error);
    return null;
  }
}

export function insertMessageEvents({ messageId, conversationId, events }) {
  if (!messageId || !conversationId || !Array.isArray(events) || events.length === 0) return;
  const db = getDb();
  if (!isMessageEventsTableAvailable(db)) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO message_events (message_id, conversation_id, seq, type, payload, created_at)
     VALUES (@messageId, @conversationId, @seq, @type, @payload, @now)`
  );

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });

  const rows = events.map((event) => ({
    messageId,
    conversationId,
    seq: typeof event.seq === 'number' ? event.seq : 0,
    type: event.type,
    payload: serializePayload(event.payload),
    now,
  }));

  insertMany(rows);
}

export function getMessageEventsByMessageIds(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return {};
  const db = getDb();
  if (!isMessageEventsTableAvailable(db)) return {};
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, message_id, conversation_id, seq, type, payload, created_at
       FROM message_events
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, seq ASC`
    )
    .all(...messageIds);

  const eventsByMessage = {};
  for (const row of rows) {
    if (!eventsByMessage[row.message_id]) {
      eventsByMessage[row.message_id] = [];
    }
    eventsByMessage[row.message_id].push({
      id: row.id,
      seq: row.seq,
      type: row.type,
      payload: parsePayload(row.payload, row.id),
      created_at: row.created_at,
    });
  }

  return eventsByMessage;
}
