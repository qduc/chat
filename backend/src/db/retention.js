import { getDb } from './client.js';

export function retentionSweep({ days }) {
  let db;
  try {
    db = getDb();
  } catch (_) {
    return { deleted: 0 };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const selectStmt = db.prepare(
    `SELECT id FROM conversations
     WHERE datetime(created_at) < datetime(@cutoff)
       AND (json_extract(metadata,'$.pinned') IS NULL OR json_extract(metadata,'$.pinned') = 0)
     LIMIT 500`
  );
  const deleteMessages = db.prepare(
    `DELETE FROM messages WHERE conversation_id=@id`
  );
  const deleteConversation = db.prepare(
    `DELETE FROM conversations WHERE id=@id`
  );

  let total = 0;
  while (true) {
    const rows = selectStmt.all({ cutoff });
    if (!rows.length) break;
    const tx = db.transaction((ids) => {
      for (const r of ids) {
        deleteMessages.run({ id: r.id });
        deleteConversation.run({ id: r.id });
      }
    });
    tx(rows);
    total += rows.length;
    if (rows.length < 500) break;
  }
  return { deleted: total };
}
