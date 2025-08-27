// Tests for unified tool system - backend as single source of truth

import { getToolSpecs } from '../lib/chat';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useChatStream } from '../hooks/useChatStream';

// Mock fetch for testing
const mockFetch = (response: Response) => {
  return jest.fn().mockResolvedValue(response);
};

describe('Unified Tool System', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('getToolSpecs API', () => {
    it('should fetch tool specifications from backend', async () => {
      const mockResponse = new Response(JSON.stringify({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get the current time in ISO format with timezone information',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Perform a web search using Tavily API to get current information',
              parameters: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query to execute'
                  }
                },
                required: ['query']
              }
            }
          }
        ],
        available_tools: ['get_time', 'web_search']
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      const fetchSpy = mockFetch(mockResponse);
      global.fetch = fetchSpy;

      const result = await getToolSpecs();

      // Behavior: fetch is invoked and result is parsed correctly
      expect(fetchSpy).toHaveBeenCalled();

      expect(result).toEqual({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get the current time in ISO format with timezone information',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Perform a web search using Tavily API to get current information',
              parameters: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The search query to execute'
                  }
                },
                required: ['query']
              }
            }
          }
        ],
        available_tools: ['get_time', 'web_search']
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockResponse = new Response(JSON.stringify({
        error: 'Failed to generate tool specifications'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });

      const fetchSpy = mockFetch(mockResponse);
      global.fetch = fetchSpy;

      await expect(getToolSpecs()).rejects.toThrow('Failed to generate tool specifications');
    });
  });

  describe('useChatStream hook tool integration', () => {
    it('should fetch tool specs on mount and use them in chat', async () => {
      const toolSpecsResponse = new Response(JSON.stringify({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get current time',
              parameters: { type: 'object', properties: {} }
            }
          }
        ],
        available_tools: ['get_time']
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      const chatResponse = new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });

      const fetchSpy = jest.fn()
        .mockResolvedValueOnce(toolSpecsResponse) // First call: get tool specs
        .mockResolvedValueOnce(chatResponse);     // Second call: send chat

      global.fetch = fetchSpy;

      const { result } = renderHook(() => useChatStream());

      // Wait for tool specs to be fetched (don’t assert URL coupling)
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      // Now call sendMessage, which should await the tool loading internally
      await act(async () => {
        await result.current.sendMessage('Test message', null, 'gpt-3.5-turbo', true, true);
      });

      // Behavior: first call loads tools, second sends chat (no endpoint/body coupling)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle tool spec fetch failure gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useChatStream());

      // Wait a bit to let useEffect run
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch tool specs:', expect.any(Error));
      });

      // Tool specs should be empty array, but hook should still work
      expect(result.current.messages).toEqual([]);

      consoleSpy.mockRestore();
    });
  });
});
