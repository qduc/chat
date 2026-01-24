export default {
  version: 27,
  up: `
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        model_a_conversation_id TEXT NOT NULL,
        model_a_message_id TEXT NOT NULL,
        model_b_conversation_id TEXT NOT NULL,
        model_b_message_id TEXT NOT NULL,
        judge_model_id TEXT NOT NULL,
        criteria TEXT NULL,
        score_a INTEGER NULL,
        score_b INTEGER NULL,
        winner TEXT NULL,
        reasoning TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_evaluations_conversation_id
        ON evaluations(conversation_id, created_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluations_unique_pair
        ON evaluations(
          user_id,
          model_a_conversation_id,
          model_a_message_id,
          model_b_conversation_id,
          model_b_message_id,
          judge_model_id,
          criteria
        );
    `,
  down: `
      DROP INDEX IF EXISTS idx_evaluations_unique_pair;
      DROP INDEX IF EXISTS idx_evaluations_conversation_id;
      DROP TABLE IF EXISTS evaluations;
    `
};
