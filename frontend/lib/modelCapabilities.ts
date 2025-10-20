/**
 * Check if a model supports reasoning/thinking controls
 *
 * For OpenRouter: check if supported_parameters includes "reasoning"
 * For GPT-5/o3/o4 models (except *-chat variants): use hardcoded logic
 *
 * @param model - The model name/ID
 * @param modelCapabilities - Optional model capabilities data (e.g., from OpenRouter)
 * @returns true if the model supports reasoning controls
 */
export function supportsReasoningControls(
  model: string | undefined,
  modelCapabilities?: Record<string, any>
): boolean {
  if (!model || typeof model !== 'string') {
    return false;
  }

  const modelData = modelCapabilities?.[model];

  // OpenRouter/Provider models: check supported_parameters
  if (modelData?.supported_parameters) {
    return (
      Array.isArray(modelData.supported_parameters) &&
      modelData.supported_parameters.includes('reasoning')
    );
  }

  // Fallback: hardcoded logic for known thinking models
  // Extract the actual model ID (strip provider prefix if present)
  const modelId = model.includes('::') ? model.split('::')[1] : model;
  const normalized = modelId.toLowerCase();

  return (
    (normalized.startsWith('gpt-5') ||
      normalized.startsWith('o3') ||
      normalized.startsWith('o4')) &&
    !normalized.includes('chat')
  );
}
