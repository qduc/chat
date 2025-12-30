export default {
  version: 26,
  up: `
      ALTER TABLE messages ADD COLUMN metadata_json TEXT NULL;

      UPDATE messages
      SET metadata_json = CASE
        WHEN finish_reason IS NULL
          AND response_id IS NULL
          AND provider IS NULL
          AND reasoning_details IS NULL
          AND reasoning_tokens IS NULL
          AND tokens_in IS NULL
          AND tokens_out IS NULL
          AND total_tokens IS NULL
        THEN NULL
        ELSE json_object(
          'finish_reason', finish_reason,
          'response_id', response_id,
          'provider', provider,
          'reasoning_details', CASE
            WHEN reasoning_details IS NOT NULL AND json_valid(reasoning_details)
              THEN json(reasoning_details)
            ELSE NULL
          END,
          'usage', CASE
            WHEN tokens_in IS NULL
              AND tokens_out IS NULL
              AND total_tokens IS NULL
              AND reasoning_tokens IS NULL
            THEN NULL
            ELSE json_object(
              'prompt_tokens', tokens_in,
              'completion_tokens', tokens_out,
              'total_tokens', total_tokens,
              'reasoning_tokens', reasoning_tokens
            )
          END
        )
      END;
    `,
  down: `
      -- SQLite cannot drop columns easily; leave as-is
    `
};
