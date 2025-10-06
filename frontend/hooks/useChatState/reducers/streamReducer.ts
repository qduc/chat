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
      // DEBUG: Check if existing messages have seq before spreading
      console.log('[DEBUG] START_STREAMING - existing messages:', state.messages.map(m => ({
        id: m.id,
        role: m.role,
        seq: m.seq,
        hasSeq: m.seq !== undefined
      })));
      console.log('[DEBUG] START_STREAMING - new user message seq:', action.payload.userMessage.seq);

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

    case 'STREAM_TOKEN':
      return {
        ...state,
        messages: applyStreamToken(
          state.messages,
          action.payload.messageId,
          action.payload.token,
          action.payload.fullContent
        )
      };

    case 'STREAM_TOOL_CALL':
      return {
        ...state,
        messages: applyStreamToolCall(
          state.messages,
          action.payload.messageId,
          action.payload.toolCall
        )
      };

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

    case 'STREAM_USAGE':
      return {
        ...state,
        messages: applyStreamUsage(
          state.messages,
          action.payload.messageId,
          action.payload.usage
        )
      };

    case 'STREAM_COMPLETE':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
        previousResponseId: action.payload.responseId || state.previousResponseId,
      };

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

    case 'UPDATE_MESSAGE_SEQ': {
      // Update seq for the last user message and the assistant message
      const { userSeq, assistantSeq, assistantId } = action.payload;
      const updatedMessages = state.messages.map((msg, index) => {
        // Update the second-to-last message (user message) with userSeq
        if (index === state.messages.length - 2 && msg.role === 'user') {
          return { ...msg, seq: userSeq };
        }
        // Update the last message (assistant) or by assistantId
        if ((index === state.messages.length - 1 || msg.id === assistantId) && msg.role === 'assistant') {
          return { ...msg, seq: assistantSeq };
        }
        return msg;
      });
      return {
        ...state,
        messages: updatedMessages
      };
    }

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        error: null,
        previousResponseId: null,
      };

    case 'SET_MESSAGES':
      // DEBUG: Verify seq is preserved in reducer
      console.log('[DEBUG] SET_MESSAGES reducer - incoming payload:', action.payload.map(m => ({
        id: m.id,
        role: m.role,
        seq: m.seq,
        hasSeq: m.seq !== undefined
      })));
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
