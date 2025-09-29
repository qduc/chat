export function createTool({ name, description, validate, handler, openAI }) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Tool name must be a non-empty string');
  }

  if (typeof handler !== 'function') {
    throw new Error(`Tool ${name} handler must be a function`);
  }

  if (!openAI || openAI.type !== 'function' || typeof openAI.function !== 'object') {
    throw new Error(`Tool ${name} must provide an OpenAI-compatible specification`);
  }

  const safeValidate = typeof validate === 'function'
    ? validate
    : (args = {}) => args;

  const spec = {
    ...openAI,
    function: {
      ...openAI.function,
      name: openAI.function?.name || name,
      description: openAI.function?.description || description || '',
    },
  };

  return Object.freeze({
    name,
    description: description || '',
    validate: safeValidate,
    handler,
    spec,
  });
}
