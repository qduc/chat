import { buildChatConfig } from '../hooks/useChatState/utils/chatConfigBuilder';
import type { ChatMessage } from '../lib/chat';

describe('buildChatConfig', () => {
  const signal = new AbortController().signal;
  const refs = {
    modelRef: 'gpt-test',
    systemPromptRef: '',
    inlineSystemPromptRef: '',
    activeSystemPromptIdRef: null,
    shouldStreamRef: true,
    reasoningEffortRef: '',
    verbosityRef: '',
    qualityLevelRef: '',
    providerRef: null,
  } as const;

  const state = {
    conversationId: 'conv-1',
    previousResponseId: 'resp-1',
    providerId: 'provider-1',
    useTools: false,
    enabledTools: [],
    modelCapabilities: {},
  } as const;

  const callbacks = {
    onEvent: jest.fn(),
    onToken: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns only the latest user message', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'reply' },
      { id: '3', role: 'user', content: 'latest' },
    ];

    const config = buildChatConfig(messages, signal, refs, state, callbacks);

    expect(config.messages).toHaveLength(1);
    expect(config.messages[0]).toEqual({ role: 'user', content: 'latest' });
  });
});
