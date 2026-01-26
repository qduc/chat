/**
 * Shared types for streaming response handling
 */

import type { Role, ConversationMeta } from './types';

/**
 * OpenAI API stream chunk delta structure
 */
export interface StreamChunkDelta {
  role?: Role;
  content?: string;
  tool_calls?: any[];
  tool_output?: any;
  reasoning?: string;
  reasoning_content?: string;
  images?: Array<{ image_url: { url: string } }>;
}

/**
 * OpenAI API stream chunk choice structure
 */
export interface StreamChunkChoice {
  delta?: StreamChunkDelta;
  finish_reason?: string | null;
}

/**
 * OpenAI API stream chunk structure
 */
export interface StreamChunk {
  choices?: StreamChunkChoice[];
}

/**
 * Result of processing a single stream chunk
 */
export interface StreamChunkResult {
  content?: string;
  responseId?: string;
  conversation?: ConversationMeta;
  reasoningStarted?: boolean;
  reasoning_summary?: string;
  usage?: StreamUsage;
  usageSent?: boolean;
  reasoningDetails?: any[];
  reasoningTokens?: number;
}

/**
 * Usage information from streaming responses
 */
export interface StreamUsage {
  provider?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  prompt_ms?: number;
  completion_ms?: number;
}

/**
 * Event types emitted during streaming
 */
export type StreamEventType =
  | 'text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_output'
  | 'conversation'
  | 'usage'
  | 'generated_image';

/**
 * Generic stream event structure
 */
export interface StreamEvent {
  type: StreamEventType;
  value: any;
}

/**
 * Callback for receiving tokens during streaming
 */
export type OnTokenCallback = (token: string) => void;

/**
 * Callback for receiving events during streaming
 */
export type OnEventCallback = (event: StreamEvent) => void;
