/**
 * Streaming and message reducer
 * Handles real-time message streaming, tool calls, and message state
 */

import type { ChatState, ChatAction } from '../types';
import {
  applyStreamToken,
  applyStreamToolCall,
  applyStreamUsage
} from '../utils/streamHelpers';

export function streamReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
    case 'START_STREAMING':
      return {
        ...state,
        status: 'streaming',
        input: '', // Clear input immediately
        images: [], // Clear images immediately
        messages: [...state.messages, action.payload.userMessage, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'REGENERATE_START':
      return {
        ...state,
        status: 'streaming',
        input: '',
        images: [],
        messages: [...action.payload.baseMessages, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'STREAM_TOKEN': {
      const updatedMessages = applyStreamToken(
        state.messages,
        action.payload.messageId,
        action.payload.token,
        action.payload.fullContent
      );
      // Only create new state if messages actually changed
      if (updatedMessages === state.messages) {
        return state;
      }
      return {
        ...state,
        messages: updatedMessages
      };
    }

    case 'STREAM_TOOL_CALL': {
      const updatedMessages = applyStreamToolCall(
        state.messages,
        action.payload.messageId,
        action.payload.toolCall
      );
      // Only create new state if messages actually changed
      if (updatedMessages === state.messages) {
        return state;
      }
      return {
        ...state,
        messages: updatedMessages
      };
    }

    case 'STREAM_TOOL_OUTPUT': {
      const { toolMessage } = action.payload;

      // Find the assistant message that contains the tool call
      const assistantMessage = state.messages.find(m =>
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.some(tc => tc.id === (toolMessage as any).tool_call_id)
      );

      if (!assistantMessage) {
        // If no assistant message found, still add as separate message for backward compatibility
        const duplicate = state.messages.some(m =>
          (m as any).role === 'tool' &&
          (m as any).tool_call_id === (toolMessage as any).tool_call_id &&
          JSON.stringify(m.content) === JSON.stringify(toolMessage.content) &&
          ((m as any).status ?? undefined) === ((toolMessage as any).status ?? undefined)
        );

        if (duplicate) {
          return state;
        }

        return {
          ...state,
          messages: [...state.messages, toolMessage]
        };
      }

      // Attach tool output to the assistant message
      const toolOutput = {
        tool_call_id: (toolMessage as any).tool_call_id,
        output: toolMessage.content,
        status: (toolMessage as any).status || 'success'
      };

      const updatedAssistantMessage = {
        ...assistantMessage,
        tool_outputs: Array.isArray(assistantMessage.tool_outputs)
          ? [...assistantMessage.tool_outputs, toolOutput]
          : [toolOutput]
      };

      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === assistantMessage.id ? updatedAssistantMessage : m
        )
      };
    }

    case 'STREAM_USAGE': {
      const updatedMessages = applyStreamUsage(
        state.messages,
        action.payload.messageId,
        action.payload.usage
      );
      // Only create new state if messages actually changed
      if (updatedMessages === state.messages) {
        return state;
      }
      return {
        ...state,
        messages: updatedMessages
      };
    }

    case 'STREAM_COMPLETE': {
      // Store responseId in the assistant message if available
      const { responseId } = action.payload;
      if (!responseId) {
        return {
          ...state,
          status: 'idle',
          abort: undefined,
        };
      }

      // Find the last assistant message and attach responseId
      const updatedMessages = [...state.messages];
      for (let i = updatedMessages.length - 1; i >= 0; i--) {
        if (updatedMessages[i].role === 'assistant') {
          updatedMessages[i] = { ...updatedMessages[i], responseId };
          break;
        }
      }

      return {
        ...state,
        status: 'idle',
        abort: undefined,
        messages: updatedMessages,
      };
    }

    case 'STREAM_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.payload,
        abort: undefined,
      };

    case 'STOP_STREAMING':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
      };

    case 'APPEND_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };

    case 'SYNC_MESSAGE_ID': {
      const { role, tempId, persistedId } = action.payload;
      let changed = false;
      const updatedMessages = state.messages.map(msg => {
        if (msg.id === tempId && msg.role === role) {
          changed = true;
          return { ...msg, id: persistedId };
        }
        return msg;
      });

      if (!changed) {
        return state;
      }

      const nextEditingId = state.editingMessageId === tempId ? persistedId : state.editingMessageId;

      return {
        ...state,
        messages: updatedMessages,
        editingMessageId: nextEditingId
      };
    }

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        error: null,
      };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'SYNC_ASSISTANT':
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.id !== action.payload.id) return m;
          // Only sync content and metadata that may have been finalized server-side
          const payload: any = action.payload;
          const content = payload.content ?? m.content;
          const reasoning_details = payload.reasoning_details ?? m.reasoning_details;
          const reasoning_tokens = payload.reasoning_tokens ?? m.reasoning_tokens;
          const usage = payload.usage ? { ...m.usage, ...payload.usage } : m.usage;

          return {
            ...m,
            content,
            ...(reasoning_details !== undefined ? { reasoning_details } : {}),
            ...(reasoning_tokens !== undefined ? { reasoning_tokens } : {}),
            ...(usage !== m.usage ? { usage } : {})
          };
        }),
      };

    default:
      return null; // Not handled by this reducer
  }
}
