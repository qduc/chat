import { jest } from '@jest/globals';
import { PassThrough } from 'node:stream';

import {
  createChatCompletionChunk,
  writeAndFlush,
  setupStreamingHeaders,
  teeStreamWithPreview,
} from '../src/lib/streamUtils.js';

describe('streamUtils', () => {
  describe('createChatCompletionChunk', () => {
    beforeAll(() => {
      // Mock Date.now for consistent test results
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-15T00:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    test('should create a basic chunk with content delta', () => {
      const chunk = createChatCompletionChunk(
        'chatcmpl-123',
        'gpt-4',
        { content: 'Hello' },
        null
      );

      expect(chunk).toEqual({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: Math.floor(new Date('2025-01-15T00:00:00Z').getTime() / 1000),
        model: 'gpt-4',
        choices: [{
          index: 0,
          delta: { content: 'Hello' },
          finish_reason: null,
        }],
      });
    });

    test('should create a chunk with finish reason', () => {
      const chunk = createChatCompletionChunk(
        'chatcmpl-456',
        'gpt-4o',
        { content: '' },
        'stop'
      );

      expect(chunk.choices[0].finish_reason).toBe('stop');
    });

    test('should create a chunk with empty delta', () => {
      const chunk = createChatCompletionChunk(
        'chatcmpl-789',
        'claude-3',
        {},
        null
      );

      expect(chunk.choices[0].delta).toEqual({});
      expect(chunk.choices[0].index).toBe(0);
    });

    test('should create a chunk with tool call delta', () => {
      const toolCallDelta = {
        tool_calls: [{
          index: 0,
          id: 'call_abc123',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":' }
        }]
      };

      const chunk = createChatCompletionChunk(
        'chatcmpl-tool',
        'gpt-4-turbo',
        toolCallDelta,
        null
      );

      expect(chunk.choices[0].delta.tool_calls).toBeDefined();
      expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('web_search');
    });

    test('should handle role delta for first chunk', () => {
      const chunk = createChatCompletionChunk(
        'chatcmpl-first',
        'gpt-4',
        { role: 'assistant', content: '' },
        null
      );

      expect(chunk.choices[0].delta.role).toBe('assistant');
    });
  });

  describe('writeAndFlush', () => {
    test('should call write with data', () => {
      const mockRes = {
        write: jest.fn(),
        flush: jest.fn(),
      };

      writeAndFlush(mockRes, 'test data');

      expect(mockRes.write).toHaveBeenCalledWith('test data');
      expect(mockRes.flush).toHaveBeenCalled();
    });

    test('should work when flush is not available', () => {
      const mockRes = {
        write: jest.fn(),
        // no flush method
      };

      // Should not throw
      expect(() => writeAndFlush(mockRes, 'test data')).not.toThrow();
      expect(mockRes.write).toHaveBeenCalledWith('test data');
    });

    test('should handle Buffer data', () => {
      const mockRes = {
        write: jest.fn(),
        flush: jest.fn(),
      };

      const buffer = Buffer.from('buffer data');
      writeAndFlush(mockRes, buffer);

      expect(mockRes.write).toHaveBeenCalledWith(buffer);
    });
  });

  describe('setupStreamingHeaders', () => {
    test('should set correct streaming headers', () => {
      const mockRes = {
        status: jest.fn(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
      };

      setupStreamingHeaders(mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockRes.flushHeaders).toHaveBeenCalled();
    });

    test('should work when flushHeaders is not available', () => {
      const mockRes = {
        status: jest.fn(),
        setHeader: jest.fn(),
        // no flushHeaders method
      };

      // Should not throw
      expect(() => setupStreamingHeaders(mockRes)).not.toThrow();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });
  });

  describe('teeStreamWithPreview', () => {
    test('should return null preview when response has no body', async () => {
      const result = teeStreamWithPreview(null);

      expect(result.body).toBeUndefined();
      const preview = await result.previewPromise;
      expect(preview).toBeNull();
    });

    test('should return null preview when body has no on method', async () => {
      const result = teeStreamWithPreview({ body: 'not a stream' });

      expect(result.body).toBe('not a stream');
      const preview = await result.previewPromise;
      expect(preview).toBeNull();
    });

    test('should tee stream data and capture preview', async () => {
      const original = new PassThrough();
      const response = { body: original };

      const { body, previewPromise } = teeStreamWithPreview(response, { maxPreviewBytes: 100 });

      // Collect data from the output stream
      const chunks = [];
      body.on('data', (chunk) => chunks.push(chunk));

      // Write data to original stream
      original.write('Hello ');
      original.write('World!');
      original.end();

      // Wait for streams to finish
      await new Promise(resolve => body.on('end', resolve));

      const preview = await previewPromise;
      const outputData = Buffer.concat(chunks).toString();

      expect(outputData).toBe('Hello World!');
      expect(preview).toBe('Hello World!');
    });

    test('should truncate preview at maxPreviewBytes', async () => {
      const original = new PassThrough();
      const response = { body: original };

      const { body, previewPromise } = teeStreamWithPreview(response, { maxPreviewBytes: 5 });

      // Collect data from the output stream
      const chunks = [];
      body.on('data', (chunk) => chunks.push(chunk));

      // Write more data than maxPreviewBytes
      original.write('Hello World This Is A Very Long String');
      original.end();

      // Wait for streams to finish
      await new Promise(resolve => body.on('end', resolve));

      const preview = await previewPromise;
      const outputData = Buffer.concat(chunks).toString();

      // Output should have all data
      expect(outputData).toBe('Hello World This Is A Very Long String');
      // Preview should be truncated
      expect(preview).toBe('Hello');
    });

    test('should use default maxPreviewBytes of 2048', async () => {
      const original = new PassThrough();
      const response = { body: original };

      const { body, previewPromise } = teeStreamWithPreview(response);

      // Collect output
      const chunks = [];
      body.on('data', (chunk) => chunks.push(chunk));

      // Write less than 2048 bytes using setImmediate to ensure listeners are attached
      const testData = 'a'.repeat(1000);
      setImmediate(() => {
        original.write(testData);
        original.end();
      });

      // Wait for streams to finish
      await new Promise(resolve => body.on('end', resolve));

      const preview = await previewPromise;
      expect(preview).toBe(testData);
    });

    test('should handle stream errors gracefully', async () => {
      const original = new PassThrough();
      const response = { body: original };

      const { body, previewPromise } = teeStreamWithPreview(response);

      // Attach error handler to prevent unhandled error
      body.on('error', () => { /* expected error */ });

      // Write some data then emit error
      setImmediate(() => {
        original.write('Some data');
        original.destroy(new Error('Stream error'));
      });

      // Preview should still resolve with captured data
      const preview = await previewPromise;
      expect(preview).toBe('Some data');

      // Output stream should be destroyed
      expect(body.destroyed).toBe(true);
    });

    test('should handle multiple chunks', async () => {
      const original = new PassThrough();
      const response = { body: original };

      const { body, previewPromise } = teeStreamWithPreview(response, { maxPreviewBytes: 1000 });

      const chunks = [];
      body.on('data', (chunk) => chunks.push(chunk));

      // Write multiple chunks
      for (let i = 0; i < 5; i++) {
        original.write(`chunk${i} `);
      }
      original.end();

      await new Promise(resolve => body.on('end', resolve));

      const preview = await previewPromise;
      expect(preview).toBe('chunk0 chunk1 chunk2 chunk3 chunk4 ');
    });
  });
});
