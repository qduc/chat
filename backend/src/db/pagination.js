export function clampLimit(rawLimit, { min = 1, max = 100, fallback = 20 } = {}) {
  const numericLimit = Number(rawLimit);
  if (Number.isFinite(numericLimit) && numericLimit > 0) {
    return Math.min(Math.max(numericLimit, min), max);
  }
  return fallback;
}

export function parseCreatedAtCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') {
    return { cursorCreatedAt: null, cursorId: null };
  }
  const pipeIdx = cursor.indexOf('|');
  if (pipeIdx > 0) {
    return {
      cursorCreatedAt: cursor.slice(0, pipeIdx),
      cursorId: cursor.slice(pipeIdx + 1),
    };
  }
  return { cursorCreatedAt: cursor, cursorId: null };
}

export function appendCreatedAtCursor(sql, {
  cursorCreatedAt,
  cursorId,
  createdAtColumn = 'created_at',
  idColumn = 'id',
} = {}) {
  if (!cursorCreatedAt) {
    return sql;
  }
  let clause = ` AND (datetime(${createdAtColumn}) < datetime(@cursorCreatedAt)`;
  if (cursorId) {
    clause += ` OR (datetime(${createdAtColumn}) = datetime(@cursorCreatedAt) AND ${idColumn} < @cursorId)`;
  }
  clause += `)`;
  return sql + clause;
}
