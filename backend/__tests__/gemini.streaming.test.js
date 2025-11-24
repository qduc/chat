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
  });

  it('should return null for invalid chunks', () => {
    const provider = new GeminiProvider({ config: {}, providerId: 'test' });

    expect(provider.translateStreamChunk(null)).toBeNull();
    expect(provider.translateStreamChunk({})).toBeNull();
    expect(provider.translateStreamChunk({ candidates: [] })).toBeNull();
  });
});
