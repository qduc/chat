export default {
  version: 28,
  up: `
    CREATE TABLE IF NOT EXISTS evaluation_models (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      model_id TEXT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      score REAL NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_evaluation_models_evaluation_id
      ON evaluation_models(evaluation_id);

    CREATE INDEX IF NOT EXISTS idx_evaluation_models_user_id
      ON evaluation_models(user_id);
  `,
  down: `
    DROP INDEX IF EXISTS idx_evaluation_models_user_id;
    DROP INDEX IF EXISTS idx_evaluation_models_evaluation_id;
    DROP TABLE IF EXISTS evaluation_models;
  `
};
