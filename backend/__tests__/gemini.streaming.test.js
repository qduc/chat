
import { GeminiProvider } from '../src/lib/providers/geminiProvider.js';

describe('Gemini Provider Streaming Translation', () => {
  it('should correctly indicate it needs streaming translation', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    expect(provider.needsStreamingTranslation()).toBe(true);
  });

  it('should translate Gemini SSE chunk to OpenAI format', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    // Mock Gemini API response chunk
    const geminiChunk = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Hello, this is a test response'
              }
            ],
            role: 'model'
          },
          finishReason: null,
          index: 0
        }
      ]
    };

    const translated = provider.translateStreamChunk(geminiChunk);

    // Verify it's in OpenAI format
    expect(translated).toBeDefined();
    expect(translated.object).toBe('chat.completion.chunk');
    expect(translated.choices).toBeDefined();
    expect(translated.choices[0]).toBeDefined();
    expect(translated.choices[0].delta).toBeDefined();
    expect(translated.choices[0].delta.role).toBe('assistant');
    expect(translated.choices[0].delta.content).toBe('Hello, this is a test response');
    expect(translated.choices[0].index).toBe(0);
  });

  it('should handle Gemini finish reason conversion', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    const testCases = [
      { geminiReason: 'STOP', expectedReason: 'stop' },
      { geminiReason: 'MAX_TOKENS', expectedReason: 'length' },
      { geminiReason: 'SAFETY', expectedReason: 'content_filter' },
      { geminiReason: 'RECITATION', expectedReason: 'content_filter' },
      { geminiReason: 'OTHER', expectedReason: 'stop' },
      { geminiReason: null, expectedReason: null }
    ];

    for (const { geminiReason, expectedReason } of testCases) {
      const chunk = {
        candidates: [
          {
            content: {
              parts: [{ text: 'test' }],
              role: 'model'
            },
            finishReason: geminiReason,
            index: 0
          }
        ]
      };

      const translated = provider.translateStreamChunk(chunk);
      expect(translated.choices[0].finish_reason).toBe(expectedReason);
    }
  });

  it('should handle Gemini chunks with function calls', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    const geminiChunk = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Let me search for that'
              },
              {
                functionCall: {
                  name: 'search',
                  args: {
                    query: 'test query'
                  }
                }
              }
            ],
            role: 'model'
          },
          finishReason: null,
          index: 0
        }
      ]
    };

    const translated = provider.translateStreamChunk(geminiChunk);

    expect(translated.choices[0].delta.content).toBe('Let me search for that');
    expect(translated.choices[0].delta.tool_calls).toBeDefined();
    expect(translated.choices[0].delta.tool_calls[0].type).toBe('function');
    expect(translated.choices[0].delta.tool_calls[0].function.name).toBe('search');
    expect(translated.choices[0].delta.tool_calls[0].function.arguments).toBe(
      JSON.stringify({ query: 'test query' })
    );
    expect(translated.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should return null for invalid chunks', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    expect(provider.translateStreamChunk(null)).toBeNull();
    expect(provider.translateStreamChunk({})).toBeNull();
    expect(provider.translateStreamChunk({ candidates: [] })).toBeNull();
  });

  // NEW TESTS START HERE

  it('should suppress empty STOP chunk after tool calls', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    const stopChunk = {
        candidates: [{
            content: { parts: [{ text: "" }], role: "model" },
            finishReason: "STOP",
            index: 0
        }]
    };

    const translated = provider.translateStreamChunk(stopChunk);
    // Should return null to suppress the STOP overwrite
    expect(translated).toBeNull();
  });

  it('should extract thoughtSignature from tool calls', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    const chunkWithSignature = {
        candidates: [{
            content: {
                parts: [{
                    functionCall: { name: "search", args: {} },
                    thoughtSignature: "sig_123"
                }],
                role: "model"
            },
            index: 0
        }]
    };

    const translated = provider.translateStreamChunk(chunkWithSignature);
    const toolCall = translated.choices[0].delta.tool_calls[0];

    expect(toolCall.gemini_thought_signature).toBe("sig_123");
  });

  it('should inject thoughtSignature back into translateRequest', async () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    const request = {
        model: 'gemini-1.5-pro',
        messages: [
            {
                role: 'assistant',
                tool_calls: [{
                    id: 'call_1',
                    function: { name: 'search', arguments: '{}' },
                    gemini_thought_signature: 'restored_sig'
                }]
            }
        ]
    };

    const translated = await provider.translateRequest(request);
    const part = translated.contents[0].parts[0];

    expect(part.functionCall).toBeDefined();
    expect(part.thoughtSignature).toBe('restored_sig');
  });

  it('should parse SSE string chunks', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    const sseString = 'data: {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}';

    const translated = provider.translateStreamChunk(sseString);
    expect(translated.choices[0].delta.content).toBe('hello');
  });

  it('should generate stable tool call IDs using responseId', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    const chunk = {
      responseId: 'resp_123',
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'test', args: {} } }]
        }
      }]
    };

    const translated = provider.translateStreamChunk(chunk);
    expect(translated.choices[0].delta.tool_calls[0].id).toBe('call_resp_123_0');
  });

  it('should suppress empty STOP chunks to preserve tool_calls state', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    const emptyStopChunk = {
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [] }
      }]
    };

    const translated = provider.translateStreamChunk(emptyStopChunk);
    expect(translated).toBeNull();
  });

  it('should handle [DONE] signal', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    expect(provider.translateStreamChunk('data: [DONE]')).toBeNull();
  });

  it('should return null for invalid JSON string chunks', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });
    expect(provider.translateStreamChunk('data: { invalid json }')).toBeNull();
  });
});
