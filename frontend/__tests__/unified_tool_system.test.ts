// Tests for unified tool system - backend as single source of truth

import { ToolsClient } from '../lib/chat';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useChatState } from '../hooks/useChatState';

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

  describe('ToolsClient API', () => {
    it('should fetch tool specifications from backend', async () => {
      const mockResponse = new Response(JSON.stringify({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get current time',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          }
        ],
        available_tools: ['get_time']
      }), { status: 200 });

      global.fetch = mockFetch(mockResponse);

      const toolsClient = new ToolsClient();
      const result = await toolsClient.getToolSpecs();

      // Behavior: fetch is invoked and result is parsed correctly
      expect(global.fetch).toHaveBeenCalled();

      expect(result).toEqual({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get current time',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          }
        ],
        available_tools: ['get_time']
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

      const toolsClient = new ToolsClient();
      await expect(toolsClient.getToolSpecs()).rejects.toThrow('Failed to generate tool specifications');
    });
  });

  describe('useChatState tool integration', () => {
    it('sends chat and completes stream with tools enabled', async () => {
      const chatResponse = new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });

      const fetchSpy = jest.fn().mockResolvedValue(chatResponse);
      global.fetch = fetchSpy;

      const { result } = renderHook(() => useChatState());

      await act(async () => {
        result.current.actions.setInput('Test message');
      });

      // Wait for state to reflect input
      await waitFor(() => expect(result.current.state.input).toBe('Test message'));

      await act(async () => {
        await result.current.actions.sendMessage();
      });

      expect(fetchSpy).toHaveBeenCalled();
      // Wait for user + assistant placeholder messages
      await waitFor(() => expect(result.current.state.messages.length).toBeGreaterThanOrEqual(2));
    });
  });
});
