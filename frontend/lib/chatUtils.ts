import type {
  ConversationMeta,
  MessageContent,
  TextContent,
  ImageContent,
  ChatMessage,
} from './types';
import { APIError } from './streaming';

/**
 * Helper function to convert ConversationMeta to a simpler Conversation format
 */
export function convertConversationMeta(meta: ConversationMeta) {
  return {
    id: meta.id,
    title: meta.title || '',
    created_at: meta.created_at,
    updatedAt: meta.created_at, // Use created_at as updatedAt fallback
  };
}

/**
 * Helper function to merge tool outputs from tool messages into assistant messages
 */
export function mergeToolOutputsToAssistantMessages(messages: any[]): any[] {
  // Build a map of tool_call_id to assistant message for quick lookup
  const assistantMessagesByToolCallId = new Map<string, any>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.id) {
          assistantMessagesByToolCallId.set(toolCall.id, msg);
        }
      }
    }
  }

  // Process messages and merge tool outputs
  const result: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Handle tool messages with tool_outputs array (streaming format)
      if (msg.tool_outputs) {
        for (const output of msg.tool_outputs) {
          const toolCallId = output.tool_call_id;
          if (toolCallId) {
            const assistantMsg = assistantMessagesByToolCallId.get(toolCallId);
            if (assistantMsg) {
              // Initialize tool_outputs array if needed
              if (!assistantMsg.tool_outputs) {
                assistantMsg.tool_outputs = [];
              }
              // Add the output if not already present
              const exists = assistantMsg.tool_outputs.some(
                (o: any) => o.tool_call_id === toolCallId
              );
              if (!exists) {
                assistantMsg.tool_outputs.push(output);
              }
            }
          }
        }
      }

      // Handle tool messages with tool_call_id and content (database format)
      if (msg.tool_call_id && msg.content) {
        const assistantMsg = assistantMessagesByToolCallId.get(msg.tool_call_id);
        if (assistantMsg) {
          // Initialize tool_outputs array if needed
          if (!assistantMsg.tool_outputs) {
            assistantMsg.tool_outputs = [];
          }
          // Add the output if not already present
          const exists = assistantMsg.tool_outputs.some(
            (o: any) => o.tool_call_id === msg.tool_call_id
          );
          if (!exists) {
            // Convert database format to tool_outputs format
            assistantMsg.tool_outputs.push({
              tool_call_id: msg.tool_call_id,
              output: msg.content,
              status: 'success',
            });
          }
        }
      }

      // Skip all tool messages - don't add them to the result
      continue;
    }

    // Add all non-tool messages to the result
    result.push(msg);
  }

  return result;
}

/**
 * Merges a tool call delta into an existing array of tool calls
 */
export function mergeToolCallDelta(existingToolCalls: any[], tcDelta: any, textOffset: number) {
  const existingIdx = tcDelta.id
    ? existingToolCalls.findIndex((tc: any) => tc.id === tcDelta.id)
    : existingToolCalls.findIndex((tc: any) => (tc.index ?? 0) === (tcDelta.index ?? 0));

  if (existingIdx >= 0) {
    const updatedToolCalls = [...existingToolCalls];
    const existing = { ...updatedToolCalls[existingIdx] };
    if (tcDelta.id) existing.id = tcDelta.id;
    if (tcDelta.type) existing.type = tcDelta.type;
    if (tcDelta.index !== undefined) existing.index = tcDelta.index;
    if (tcDelta.function?.name) {
      existing.function = { ...existing.function, name: tcDelta.function.name };
    }
    if (tcDelta.function?.arguments) {
      existing.function = {
        ...existing.function,
        arguments: (existing.function?.arguments || '') + tcDelta.function.arguments,
      };
    }
    updatedToolCalls[existingIdx] = existing;
    return updatedToolCalls;
  }

  return [
    ...existingToolCalls,
    {
      id: tcDelta.id,
      type: tcDelta.type || 'function',
      index: tcDelta.index ?? existingToolCalls.length,
      textOffset,
      function: {
        name: tcDelta.function?.name || '',
        arguments: tcDelta.function?.arguments || '',
      },
    },
  ];
}

/**
 * Checks if an assistant message has no meaningful content or tool usage
 */
export function isEmptyAssistantPayload(
  content: MessageContent,
  toolCalls?: any[],
  toolOutputs?: any[]
): boolean {
  const hasContent =
    typeof content === 'string'
      ? content.trim().length > 0
      : Array.isArray(content)
        ? content.length > 0
        : content != null;
  const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
  const hasToolOutputs = Array.isArray(toolOutputs) && toolOutputs.length > 0;
  return !hasContent && !hasToolCalls && !hasToolOutputs;
}

/**
 * Helper to create content update with generated image appended
 */
export function createGeneratedImageContentUpdate(
  currentContent: MessageContent,
  imageUrl: string
):
  | { content: (TextContent | { type: 'image_url'; image_url: { url: string } })[] }
  | Record<string, never> {
  const newImageContent = {
    type: 'image_url' as const,
    image_url: { url: imageUrl },
  };

  let contentArray: (TextContent | { type: 'image_url'; image_url: { url: string } })[];
  if (typeof currentContent === 'string') {
    contentArray = currentContent ? [{ type: 'text' as const, text: currentContent }] : [];
  } else if (Array.isArray(currentContent)) {
    contentArray = [...currentContent] as (
      | TextContent
      | { type: 'image_url'; image_url: { url: string } }
    )[];
  } else {
    contentArray = [];
  }

  contentArray.push(newImageContent);
  return { content: contentArray };
}

/**
 * Builds a message history scoped to a specific target model
 */
export function buildHistoryForModel(
  sourceMessages: any[],
  targetModel: string,
  isPrimary: boolean
): any[] {
  if (isPrimary) {
    return sourceMessages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_outputs: msg.tool_outputs,
    }));
  }

  const history: any[] = [];

  for (const msg of sourceMessages) {
    if (msg.role === 'assistant') {
      const comparison = msg.comparisonResults?.[targetModel];
      if (!comparison) continue;
      const content = comparison.content ?? '';
      if (isEmptyAssistantPayload(content, comparison.tool_calls, comparison.tool_outputs)) {
        continue;
      }
      history.push({
        id: msg.id,
        role: msg.role,
        content,
        tool_calls: comparison.tool_calls,
        tool_outputs: comparison.tool_outputs,
      });
      continue;
    }

    if (msg.role === 'tool') {
      continue;
    }

    history.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      tool_outputs: msg.tool_outputs,
    });
  }

  return history;
}

/**
 * Prepends a reasoning (thinking) block to message content
 */
export function prependReasoningToContent(
  content: MessageContent,
  reasoningText: string
): MessageContent {
  const normalizedReasoning = reasoningText.trim();
  if (!normalizedReasoning) {
    return content;
  }

  const thinkingBlock = `<thinking>${normalizedReasoning}</thinking>`;

  if (!content || (typeof content === 'string' && content.trim().length === 0)) {
    return thinkingBlock;
  }

  if (typeof content === 'string') {
    if (content.includes('<thinking>')) {
      return content;
    }
    const suffix = content.length > 0 ? `\n\n${content}` : '';
    return `${thinkingBlock}${suffix}`;
  }

  if (!Array.isArray(content)) {
    return thinkingBlock;
  }

  const hasExistingThinking = content.some(
    (item) => item.type === 'text' && item.text.includes('<thinking>')
  );
  if (hasExistingThinking) {
    return content;
  }

  const updated = [...content];
  const firstTextIndex = updated.findIndex((item) => item.type === 'text');

  if (firstTextIndex === -1) {
    return [{ type: 'text', text: thinkingBlock }, ...updated];
  }

  const firstItem = updated[firstTextIndex];
  if (firstItem.type === 'text') {
    const suffix = firstItem.text.length > 0 ? `\n\n${firstItem.text}` : '';
    updated[firstTextIndex] = {
      ...firstItem,
      text: `${thinkingBlock}${suffix}`,
    } as TextContent;
  }

  return updated;
}

/**
 * Formats API errors for display
 */
export function formatUpstreamError(error: APIError): string {
  const body =
    error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : null;
  const upstream =
    body && typeof body.upstream === 'object' && body.upstream !== null
      ? (body.upstream as Record<string, unknown>)
      : null;

  const upstreamMessage = typeof upstream?.message === 'string' ? upstream.message.trim() : '';
  const bodyMessage = typeof body?.message === 'string' ? body.message.trim() : '';
  const statusValue =
    upstream && upstream.status !== undefined && upstream.status !== null
      ? upstream.status
      : undefined;
  const statusPart = statusValue !== undefined ? ` (status ${statusValue})` : '';

  if (upstreamMessage) {
    return `Upstream provider error${statusPart}: ${upstreamMessage}`;
  }

  if (bodyMessage) {
    return `Upstream provider error${statusPart}: ${bodyMessage}`;
  }

  return error.message;
}
