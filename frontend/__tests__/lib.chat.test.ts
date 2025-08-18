// Test stubs for frontend lib functions in lib/chat.ts
/* eslint-disable */
// Declare Jest-like globals to keep TypeScript happy without a runner setup
declare const describe: any;
declare const test: any;
import type { Role } from '../lib/chat';

describe('sendChat', () => {
  test.todo('POSTs to /v1/chat/completions with stream=true and aggregates tokens');
  test.todo('invokes onToken for each streamed delta');
  test.todo('throws on non-OK responses with message from JSON');
  test.todo('supports AbortController to stop streaming');
  test.todo('includes conversation_id when provided');
});

describe('createConversation', () => {
  test.todo('POSTs to /v1/conversations and returns ConversationMeta');
  test.todo('propagates 501 when persistence is disabled');
});

describe('listConversationsApi', () => {
  test.todo('GETs /v1/conversations with cursor+limit and returns items/next_cursor');
});

describe('getConversationApi', () => {
  test.todo('GETs /v1/conversations/:id and returns metadata+messages');
  test.todo('supports after_seq and limit');
});

describe('deleteConversationApi', () => {
  test.todo('DELETEs /v1/conversations/:id and returns true on 204');
});

export {};
