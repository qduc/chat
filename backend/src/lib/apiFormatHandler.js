export function determineApiFormat(bodyIn, config) {
  const hasTools = Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0;

  // If tools are present, force Chat Completions path for MVP (server orchestration)
  if (hasTools) {
    // Check if user explicitly requests research mode (iterative orchestration)
    const useResearchMode = bodyIn.research_mode === true;
    return {
      hasTools: true,
      useIterativeOrchestration: useResearchMode
    };
  }
  return {
    hasTools: false,
    useIterativeOrchestration: false
  };
}

export function prepareRequestBody(bodyIn, apiFormat, config) {
  // Clone and strip non-upstream fields
  const body = { ...bodyIn };
  delete body.conversation_id;
  delete body.disable_responses_api;
  delete body.previous_response_id;
  delete body.research_mode;

  if (!body.model) body.model = config.defaultModel;

  // ...existing code...

  return body;
}

export function buildUpstreamUrl(config) {
  return `${config.openaiBaseUrl}/chat/completions`;
}

export function createHeaders(config) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
}

function findLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === 'user') {
      return message;
    }
  }
  return null;
}