function toNumber(value) {
  if (value == null) return undefined;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return undefined;
  return asNumber;
}

function coalesceNumber(...values) {
  for (const value of values) {
    const num = toNumber(value);
    if (num != null) return num;
  }
  return undefined;
}

function sumNumbers(...values) {
  let total = 0;
  let found = false;
  for (const value of values) {
    const num = toNumber(value);
    if (num == null) continue;
    total += num;
    found = true;
  }
  return found ? total : undefined;
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;

  const promptTokens = coalesceNumber(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.input_token_count,
    usage.prompt_token_count,
    usage.promptTokenCount,
    usage.inputTokenCount,
  );

  const completionTokens = coalesceNumber(
    usage.completion_tokens,
    usage.output_tokens,
    usage.output_token_count,
    usage.completion_token_count,
    usage.candidatesTokenCount,
    usage.outputTokenCount,
  );

  const cacheCreationTokens = coalesceNumber(
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
  );

  const cacheReadTokens = coalesceNumber(
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
  );

  const totalTokens = coalesceNumber(
    usage.total_tokens,
    usage.total_token_count,
    usage.totalTokenCount,
  ) ?? sumNumbers(
    promptTokens,
    completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
  );

  const reasoningTokens = coalesceNumber(
    usage.reasoning_tokens,
    usage.reasoning_token_count,
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.output_tokens_details?.reasoning_tokens,
    usage.thoughtsTokenCount,
    usage.thoughts_token_count,
  );

  const mapped = {};
  if (promptTokens != null) mapped.prompt_tokens = promptTokens;
  if (completionTokens != null) mapped.completion_tokens = completionTokens;
  if (totalTokens != null) mapped.total_tokens = totalTokens;
  if (reasoningTokens != null) mapped.reasoning_tokens = reasoningTokens;

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function extractUsage(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const direct = normalizeUsage(payload.usage);
  if (direct) return direct;

  const metadata = normalizeUsage(payload.usageMetadata || payload.usage_metadata);
  if (metadata) return metadata;

  const nested = normalizeUsage(payload.response?.usage);
  if (nested) return nested;

  return undefined;
}
