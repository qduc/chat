export default {
  version: 13,
  up: `
    -- Update existing providers metadata to rename 'default_model' key to 'model_filter'
    UPDATE providers
    SET metadata = json_set(
      json_remove(metadata, '$.default_model'),
      '$.model_filter',
      json_extract(metadata, '$.default_model')
    )
    WHERE json_extract(metadata, '$.default_model') IS NOT NULL;
  `,
  down: `
    -- Revert: rename 'model_filter' back to 'default_model' in metadata
    UPDATE providers
    SET metadata = json_set(
      json_remove(metadata, '$.model_filter'),
      '$.default_model',
      json_extract(metadata, '$.model_filter')
    )
    WHERE json_extract(metadata, '$.model_filter') IS NOT NULL;
  `
};