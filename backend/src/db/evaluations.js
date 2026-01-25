import { getDb } from './client.js';
import { v4 as uuidv4 } from 'uuid';

export function listEvaluationsForConversation({ conversationId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }
  const db = getDb();
  const query = `SELECT id, user_id, conversation_id, model_a_conversation_id, model_a_message_id,
      model_b_conversation_id, model_b_message_id, judge_model_id, criteria,
      score_a, score_b, winner, reasoning, created_at
    FROM evaluations
    WHERE conversation_id = @conversationId AND user_id = @userId
    ORDER BY created_at ASC`;
  const evaluations = db.prepare(query).all({ conversationId, userId });
  if (!evaluations.length) return evaluations;

  const evaluationIds = evaluations.map((row) => row.id);
  const modelsByEvaluationId = listEvaluationModelsByEvaluationIds({
    evaluationIds,
    userId,
  });

  return evaluations.map((evaluation) => ({
    ...evaluation,
    models: modelsByEvaluationId.get(evaluation.id) || [],
  }));
}

export function getEvaluationByPair({
  userId,
  conversationId,
  modelAConversationId,
  modelAMessageId,
  modelBConversationId,
  modelBMessageId,
  judgeModelId,
  criteria,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT id, user_id, conversation_id, model_a_conversation_id, model_a_message_id,
      model_b_conversation_id, model_b_message_id, judge_model_id, criteria,
      score_a, score_b, winner, reasoning, created_at
    FROM evaluations
    WHERE user_id = @userId
      AND conversation_id = @conversationId
      AND model_a_conversation_id = @modelAConversationId
      AND model_a_message_id = @modelAMessageId
      AND model_b_conversation_id = @modelBConversationId
      AND model_b_message_id = @modelBMessageId
      AND judge_model_id = @judgeModelId
      AND (criteria IS @criteria OR (criteria IS NULL AND @criteria IS NULL))
    LIMIT 1`;

  const evaluation = db.prepare(query).get({
    userId,
    conversationId,
    modelAConversationId,
    modelAMessageId,
    modelBConversationId,
    modelBMessageId,
    judgeModelId,
    criteria: criteria ?? null,
  });

  if (!evaluation) return null;
  const modelsByEvaluationId = listEvaluationModelsByEvaluationIds({
    evaluationIds: [evaluation.id],
    userId,
  });

  return {
    ...evaluation,
    models: modelsByEvaluationId.get(evaluation.id) || [],
  };
}

export function createEvaluation({
  userId,
  conversationId,
  modelAConversationId,
  modelAMessageId,
  modelBConversationId,
  modelBMessageId,
  judgeModelId,
  criteria,
  scoreA,
  scoreB,
  winner,
  reasoning,
  createdAt,
  models,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const id = uuidv4();
  const created_at = createdAt || new Date().toISOString();

  const query = `INSERT INTO evaluations (
      id, user_id, conversation_id, model_a_conversation_id, model_a_message_id,
      model_b_conversation_id, model_b_message_id, judge_model_id, criteria,
      score_a, score_b, winner, reasoning, created_at
    ) VALUES (
      @id, @userId, @conversationId, @modelAConversationId, @modelAMessageId,
      @modelBConversationId, @modelBMessageId, @judgeModelId, @criteria,
      @scoreA, @scoreB, @winner, @reasoning, @created_at
    )`;

  db.prepare(query).run({
    id,
    userId,
    conversationId,
    modelAConversationId,
    modelAMessageId,
    modelBConversationId,
    modelBMessageId,
    judgeModelId,
    criteria: criteria ?? null,
    scoreA: scoreA ?? null,
    scoreB: scoreB ?? null,
    winner: winner ?? null,
    reasoning: reasoning ?? null,
    created_at,
  });

  const modelRows = Array.isArray(models) && models.length > 0
    ? models
    : [
        {
          modelId: 'primary',
          conversationId: modelAConversationId,
          messageId: modelAMessageId,
          score: scoreA ?? null,
        },
        {
          modelId: null,
          conversationId: modelBConversationId,
          messageId: modelBMessageId,
          score: scoreB ?? null,
        },
      ];

  const modelInsert = db.prepare(`INSERT INTO evaluation_models (
      id, evaluation_id, user_id, model_id, conversation_id, message_id, score
    ) VALUES (
      @id, @evaluationId, @userId, @modelId, @conversationId, @messageId, @score
    )`);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      modelInsert.run({
        id: uuidv4(),
        evaluationId: id,
        userId,
        modelId: row.modelId ?? null,
        conversationId: row.conversationId,
        messageId: row.messageId,
        score: row.score ?? null,
      });
    }
  });

  insertMany(modelRows);

  return {
    id,
    user_id: userId,
    conversation_id: conversationId,
    model_a_conversation_id: modelAConversationId,
    model_a_message_id: modelAMessageId,
    model_b_conversation_id: modelBConversationId,
    model_b_message_id: modelBMessageId,
    judge_model_id: judgeModelId,
    criteria: criteria ?? null,
    score_a: scoreA ?? null,
    score_b: scoreB ?? null,
    winner: winner ?? null,
    reasoning: reasoning ?? null,
    created_at,
    models: modelRows.map((row) => ({
      model_id: row.modelId ?? null,
      conversation_id: row.conversationId,
      message_id: row.messageId,
      score: row.score ?? null,
    })),
  };
}

export function deleteEvaluation({ id, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }
  const db = getDb();
  db.prepare(`DELETE FROM evaluation_models WHERE evaluation_id = @id AND user_id = @userId`).run({
    id,
    userId,
  });
  const query = `DELETE FROM evaluations WHERE id = @id AND user_id = @userId`;
  const result = db.prepare(query).run({ id, userId });
  return result.changes > 0;
}

export function getEvaluationByModelSet({
  userId,
  conversationId,
  judgeModelId,
  criteria,
  models,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }
  const db = getDb();
  const query = `SELECT id, user_id, conversation_id, model_a_conversation_id, model_a_message_id,
      model_b_conversation_id, model_b_message_id, judge_model_id, criteria,
      score_a, score_b, winner, reasoning, created_at
    FROM evaluations
    WHERE user_id = @userId
      AND conversation_id = @conversationId
      AND judge_model_id = @judgeModelId
      AND (criteria IS @criteria OR (criteria IS NULL AND @criteria IS NULL))
    ORDER BY created_at DESC`;

  const candidates = db.prepare(query).all({
    userId,
    conversationId,
    judgeModelId,
    criteria: criteria ?? null,
  });

  if (!candidates.length) return null;

  const targetKeys = new Set(
    models.map((model) => `${model.modelId ?? ''}|${model.conversationId}|${model.messageId}`)
  );

  for (const candidate of candidates) {
    const modelsByEvaluationId = listEvaluationModelsByEvaluationIds({
      evaluationIds: [candidate.id],
      userId,
    });
    const modelRows = modelsByEvaluationId.get(candidate.id) || [];
    if (modelRows.length !== models.length) {
      continue;
    }
    const candidateKeys = new Set(
      modelRows.map(
        (row) => `${row.model_id ?? ''}|${row.conversation_id}|${row.message_id}`
      )
    );
    if (candidateKeys.size !== targetKeys.size) {
      continue;
    }
    let match = true;
    for (const key of targetKeys) {
      if (!candidateKeys.has(key)) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    return {
      ...candidate,
      models: modelRows,
    };
  }

  return null;
}

function listEvaluationModelsByEvaluationIds({ evaluationIds, userId }) {
  if (!evaluationIds || evaluationIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const placeholders = evaluationIds.map((_, idx) => `@id${idx}`).join(', ');
  const params = { userId };
  evaluationIds.forEach((id, idx) => {
    params[`id${idx}`] = id;
  });

  const rows = db
    .prepare(
      `SELECT evaluation_id, model_id, conversation_id, message_id, score
       FROM evaluation_models
       WHERE evaluation_id IN (${placeholders}) AND user_id = @userId`
    )
    .all(params);

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.evaluation_id)) {
      map.set(row.evaluation_id, []);
    }
    map.get(row.evaluation_id).push({
      model_id: row.model_id ?? null,
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      score: row.score ?? null,
    });
  }

  return map;
}
