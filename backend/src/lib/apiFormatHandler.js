export function determineApiFormat(bodyIn, config) {
  const hasTools = Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0;
  
  // If tools are present, force Chat Completions path for MVP (server orchestration)
  if (hasTools) {
    return {
      useResponsesAPI: false,
      hasTools: true,
      useIterativeOrchestration: true
    };
  }
  
  // Determine which API to use based on config and request
  const useResponsesAPI = 
    !bodyIn.disable_responses_api &&
    config.openaiBaseUrl.includes('openai.com');
  
  return {
    useResponsesAPI,
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
  
  if (!body.model) body.model = config.defaultModel;
  
  // Convert Chat Completions format to Responses API format if needed
  if (apiFormat.useResponsesAPI && body.messages) {
    // For Responses API, only send the latest user message to reduce token usage
    const lastUserMessage = findLastUserMessage(body.messages);
    body.input = lastUserMessage ? [lastUserMessage] : [];
    delete body.messages;
    
    // Add previous_response_id for conversation continuity if provided
    const previousResponseId = bodyIn.previous_response_id;
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }
  }
  
  return body;
}

export function buildUpstreamUrl(useResponsesAPI, config) {
  return useResponsesAPI
    ? `${config.openaiBaseUrl}/responses`
    : `${config.openaiBaseUrl}/chat/completions`;
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