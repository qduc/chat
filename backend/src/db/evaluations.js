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
  return db.prepare(query).all({ conversationId, userId });
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

  return db.prepare(query).get({
    userId,
    conversationId,
    modelAConversationId,
    modelAMessageId,
    modelBConversationId,
    modelBMessageId,
    judgeModelId,
    criteria: criteria ?? null,
  });
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
  };
}
