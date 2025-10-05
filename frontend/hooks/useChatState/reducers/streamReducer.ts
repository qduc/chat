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
      const duplicate = state.messages.some(m =>
        m.role === 'tool' &&
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

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        error: null,
        previousResponseId: null,
      };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'SYNC_ASSISTANT':
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.id !== action.payload.id) return m;
          // Only sync content to avoid overwriting tool_calls/tool_outputs built during streaming
          const content = (action.payload as any).content ?? m.content;
          return { ...m, content };
        }),
      };

    default:
      return null; // Not handled by this reducer
  }
}
