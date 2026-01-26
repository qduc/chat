/**
 * Tests for content utilities
 * @jest-environment jsdom
 */

import {
  extractTextFromContent,
  stringToMessageContent,
  arrayToMessageContent,
  hasImages,
  hasAudio,
  extractImagesFromContent,
  extractAudioFromContent,
  createMixedContent,
  normalizeMessageContent,
  hasFileAttachments,
  extractFilesFromText,
  removeFileBlocksFromText,
  extractFilesAndText,
  extractReasoningFromPartialJson,
  formatUsageLabel,
  buildAssistantSegments,
} from '../lib/contentUtils';
import type { MessageContent, ImageContent, TextContent, ChatMessage, Role } from '../lib/types';

describe('contentUtils', () => {
  describe('extractTextFromContent', () => {
    it('returns string content as-is', () => {
      expect(extractTextFromContent('Hello world')).toBe('Hello world');
    });

    it('returns empty string for empty input', () => {
      expect(extractTextFromContent('')).toBe('');
    });

    it('extracts text from array content', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ];
      expect(extractTextFromContent(content)).toBe('Hello world');
    });

    it('ignores non-text content in array', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
        { type: 'text', text: ' world' },
      ];
      expect(extractTextFromContent(content)).toBe('Hello world');
    });

    it('returns empty string for array with no text', () => {
      const content: MessageContent = [
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
      ];
      expect(extractTextFromContent(content)).toBe('');
    });
  });

  describe('stringToMessageContent', () => {
    it('returns the input string', () => {
      expect(stringToMessageContent('test')).toBe('test');
    });
  });

  describe('arrayToMessageContent', () => {
    it('returns the input array', () => {
      const items: Array<TextContent | ImageContent> = [{ type: 'text', text: 'test' }];
      expect(arrayToMessageContent(items)).toEqual(items);
    });
  });

  describe('hasImages', () => {
    it('returns false for string content', () => {
      expect(hasImages('Hello')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasImages('')).toBe(false);
    });

    it('returns true for array with image content', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
      ];
      expect(hasImages(content)).toBe(true);
    });

    it('returns false for array with no images', () => {
      const content: MessageContent = [{ type: 'text', text: 'Hello' }];
      expect(hasImages(content)).toBe(false);
    });
  });

  describe('hasAudio', () => {
    it('returns false for string content', () => {
      expect(hasAudio('Hello')).toBe(false);
    });

    it('returns true for array with audio content', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'input_audio', input_audio: { data: 'base64data', format: 'wav' } } as any,
      ];
      expect(hasAudio(content)).toBe(true);
    });

    it('returns false for array with no audio', () => {
      const content: MessageContent = [{ type: 'text', text: 'Hello' }];
      expect(hasAudio(content)).toBe(false);
    });
  });

  describe('extractImagesFromContent', () => {
    it('returns empty array for string content', () => {
      expect(extractImagesFromContent('Hello')).toEqual([]);
    });

    it('extracts images from array content', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'http://example.com/1.png', detail: 'auto' } },
        { type: 'image_url', image_url: { url: 'http://example.com/2.png' } },
      ];

      const images = extractImagesFromContent(content);
      expect(images).toHaveLength(2);
      expect(images[0].image_url.url).toBe('http://example.com/1.png');
      expect(images[1].image_url.url).toBe('http://example.com/2.png');
    });

    it('returns empty array when no images', () => {
      const content: MessageContent = [{ type: 'text', text: 'Hello' }];
      expect(extractImagesFromContent(content)).toEqual([]);
    });
  });

  describe('extractAudioFromContent', () => {
    it('returns empty array for string content', () => {
      expect(extractAudioFromContent('Hello')).toEqual([]);
    });

    it('extracts audio from array content', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'input_audio', input_audio: { data: 'base64data', format: 'wav' } } as any,
      ];

      const audio = extractAudioFromContent(content);
      expect(audio).toHaveLength(1);
    });
  });

  describe('createMixedContent', () => {
    it('returns string for text-only content', () => {
      expect(createMixedContent('Hello')).toBe('Hello');
    });

    it('returns empty string for empty text and no images', () => {
      expect(createMixedContent('')).toBe('');
      expect(createMixedContent('   ')).toBe('');
    });

    it('returns array for text with images', () => {
      const images: ImageContent[] = [
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
      ];
      const result = createMixedContent('Hello', images);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('returns images only when text is empty', () => {
      const images: ImageContent[] = [
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
      ];
      const result = createMixedContent('', images);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });
  });

  describe('normalizeMessageContent', () => {
    it('returns string content as-is', () => {
      expect(normalizeMessageContent('Hello')).toBe('Hello');
    });

    it('filters out empty text items', () => {
      const content: MessageContent = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'world' },
      ];

      const result = normalizeMessageContent(content);
      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).length).toBe(2);
    });

    it('converts single text item to string', () => {
      const content: MessageContent = [{ type: 'text', text: 'Hello' }];
      expect(normalizeMessageContent(content)).toBe('Hello');
    });

    it('returns empty string for empty array after filtering', () => {
      const content: MessageContent = [{ type: 'text', text: '   ' }];
      expect(normalizeMessageContent(content)).toBe('');
    });

    it('keeps non-text items', () => {
      const content: MessageContent = [
        { type: 'text', text: '' },
        { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
      ];

      const result = normalizeMessageContent(content);
      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).length).toBe(1);
      expect((result as any[])[0].type).toBe('image_url');
    });
  });

  describe('File content utilities', () => {
    describe('hasFileAttachments', () => {
      it('returns false for plain text', () => {
        expect(hasFileAttachments('Hello world')).toBe(false);
      });

      it('returns true for text with file block', () => {
        const text = `Check this file:
File: example.js
\`\`\`javascript
console.log('hello');
\`\`\``;
        expect(hasFileAttachments(text)).toBe(true);
      });
    });

    describe('extractFilesFromText', () => {
      it('returns empty array for no files', () => {
        expect(extractFilesFromText('Hello world')).toEqual([]);
      });

      it('extracts single file', () => {
        const text = `File: test.js
\`\`\`javascript
const x = 1;
\`\`\``;
        const files = extractFilesFromText(text);
        expect(files).toHaveLength(1);
        expect(files[0]).toEqual({
          type: 'file',
          name: 'test.js',
          language: 'javascript',
          content: 'const x = 1;\n',
        });
      });

      it('extracts multiple files', () => {
        const text = `File: a.js
\`\`\`js
const a = 1;
\`\`\`

File: b.py
\`\`\`python
b = 2
\`\`\``;
        const files = extractFilesFromText(text);
        expect(files).toHaveLength(2);
        expect(files[0].name).toBe('a.js');
        expect(files[1].name).toBe('b.py');
      });

      it('handles file with no language specified', () => {
        const text = `File: readme.txt
\`\`\`
Some content
\`\`\``;
        const files = extractFilesFromText(text);
        expect(files).toHaveLength(1);
        expect(files[0].language).toBe('text');
      });
    });

    describe('removeFileBlocksFromText', () => {
      it('returns text unchanged when no files', () => {
        expect(removeFileBlocksFromText('Hello world')).toBe('Hello world');
      });

      it('removes file blocks and trims result', () => {
        const text = `Here is a message
File: test.js
\`\`\`javascript
code
\`\`\`
And more text`;
        const result = removeFileBlocksFromText(text);
        expect(result).toBe('Here is a message\n\nAnd more text');
      });
    });

    describe('extractFilesAndText', () => {
      it('separates files and remaining text', () => {
        const content = `Check this:
File: example.js
\`\`\`javascript
const x = 1;
\`\`\`
Thanks!`;

        const result = extractFilesAndText(content);
        expect(result.text).toBe('Check this:\n\nThanks!');
        expect(result.files).toHaveLength(1);
        expect(result.files[0].name).toBe('example.js');
      });
    });
  });

  describe('extractReasoningFromPartialJson', () => {
    it('returns empty string for null/undefined input', () => {
      expect(extractReasoningFromPartialJson(null)).toBe('');
      expect(extractReasoningFromPartialJson(undefined)).toBe('');
      expect(extractReasoningFromPartialJson('')).toBe('');
    });

    it('returns non-JSON input as-is', () => {
      expect(extractReasoningFromPartialJson('plain text')).toBe('plain text');
    });

    it('extracts reasoning from complete JSON', () => {
      const json = '{"reasoning": "This is the reasoning"}';
      expect(extractReasoningFromPartialJson(json)).toBe('This is the reasoning');
    });

    it('handles escaped characters', () => {
      const json = '{"reasoning": "Line 1\\nLine 2\\tTabbed"}';
      expect(extractReasoningFromPartialJson(json)).toBe('Line 1\nLine 2\tTabbed');
    });

    it('returns empty when reasoning key exists but no value yet', () => {
      const partial = '{"score": 5, "reasoning"';
      expect(extractReasoningFromPartialJson(partial)).toBe('');
    });
  });

  describe('formatUsageLabel', () => {
    it('returns null for undefined usage', () => {
      expect(formatUsageLabel(undefined)).toBeNull();
    });

    it('returns null for empty usage', () => {
      expect(formatUsageLabel({})).toBeNull();
    });

    it('formats prompt and completion tokens', () => {
      expect(formatUsageLabel({ prompt_tokens: 100, completion_tokens: 50 })).toBe('↑ 100 · ↓ 50');
    });

    it('formats only prompt tokens', () => {
      expect(formatUsageLabel({ prompt_tokens: 100 })).toBe('↑ 100');
    });

    it('formats only completion tokens', () => {
      expect(formatUsageLabel({ completion_tokens: 50 })).toBe('↓ 50');
    });

    it('formats total tokens when no breakdown', () => {
      expect(formatUsageLabel({ total_tokens: 150 })).toBe('⇅ 150');
    });

    it('includes total when it differs from sum', () => {
      expect(
        formatUsageLabel({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 200 })
      ).toBe('↑ 100 · ↓ 50 · ⇅ 200');
    });
  });

  describe('buildAssistantSegments', () => {
    const createMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
      id: 'msg-1',
      role: 'assistant' as Role,
      content: 'Hello',
      created_at: new Date().toISOString(),
      ...overrides,
    });

    it('returns text segment for non-assistant message', () => {
      const msg = createMessage({ role: 'user', content: 'User text' });
      const segments = buildAssistantSegments(msg);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'text', text: 'User text' });
    });

    it('returns text segment for simple assistant message', () => {
      const msg = createMessage({ content: 'Hello world' });
      const segments = buildAssistantSegments(msg);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({ kind: 'text', text: 'Hello world' });
    });

    it('returns empty array for empty content', () => {
      const msg = createMessage({ content: '' });
      const segments = buildAssistantSegments(msg);
      expect(segments).toHaveLength(0);
    });

    it('includes images in segments', () => {
      const msg = createMessage({
        content: [
          { type: 'text', text: 'Here is an image' },
          { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
        ],
      });
      const segments = buildAssistantSegments(msg);

      expect(segments).toHaveLength(2);
      expect(segments[0].kind).toBe('text');
      expect(segments[1].kind).toBe('images');
    });

    it('handles tool calls without textOffset', () => {
      const msg = createMessage({
        content: 'Result after tools',
        tool_calls: [
          { id: 'tc-1', function: { name: 'search', arguments: '{}' }, index: 0 },
          { id: 'tc-2', function: { name: 'calculate', arguments: '{}' }, index: 1 },
        ],
        tool_outputs: [
          { tool_call_id: 'tc-1', name: 'search', content: 'Found results' },
          { tool_call_id: 'tc-2', name: 'calculate', content: '42' },
        ],
      });

      const segments = buildAssistantSegments(msg);

      // Tool calls first, then content
      expect(segments).toHaveLength(3);
      expect(segments[0].kind).toBe('tool_call');
      expect(segments[1].kind).toBe('tool_call');
      expect(segments[2].kind).toBe('text');
    });

    it('handles tool calls with textOffset for interleaved rendering', () => {
      const msg = createMessage({
        content: 'BeforeAfter',
        tool_calls: [
          { id: 'tc-1', function: { name: 'search', arguments: '{}' }, index: 0, textOffset: 6 },
        ],
        tool_outputs: [{ tool_call_id: 'tc-1', name: 'search', content: 'Found results' }],
      });

      const segments = buildAssistantSegments(msg);

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ kind: 'text', text: 'Before' });
      expect(segments[1].kind).toBe('tool_call');
      expect(segments[2]).toEqual({ kind: 'text', text: 'After' });
    });

    it('handles message_events for event-based rendering', () => {
      const msg = createMessage({
        content: 'Hello',
        tool_calls: [{ id: 'tc-1', function: { name: 'search', arguments: '{}' }, index: 0 }],
        message_events: [
          { seq: 0, type: 'content', payload: { text: 'First part' } },
          { seq: 1, type: 'tool_call', payload: { tool_call_id: 'tc-1', tool_call_index: 0 } },
          { seq: 2, type: 'content', payload: { text: 'Second part' } },
        ],
      });

      const segments = buildAssistantSegments(msg);

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ kind: 'text', text: 'First part' });
      expect(segments[1].kind).toBe('tool_call');
      expect(segments[2]).toEqual({ kind: 'text', text: 'Second part' });
    });

    it('handles reasoning events', () => {
      const msg = createMessage({
        content: 'Final answer',
        message_events: [
          { seq: 0, type: 'reasoning', payload: { text: 'Let me think...' } },
          { seq: 1, type: 'content', payload: { text: 'Final answer' } },
        ],
      });

      const segments = buildAssistantSegments(msg);

      expect(segments).toHaveLength(2);
      expect(segments[0]).toEqual({
        kind: 'text',
        text: '<thinking>Let me think...</thinking>',
      });
      expect(segments[1]).toEqual({ kind: 'text', text: 'Final answer' });
    });

    it('matches tool outputs by tool_call_id', () => {
      const msg = createMessage({
        content: '',
        tool_calls: [{ id: 'tc-123', function: { name: 'test', arguments: '{}' }, index: 0 }],
        tool_outputs: [
          { tool_call_id: 'tc-123', name: 'test', content: 'output content' },
          { tool_call_id: 'other', name: 'other', content: 'other output' },
        ],
      });

      const segments = buildAssistantSegments(msg);

      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe('tool_call');
      const toolSegment = segments[0] as any;
      expect(toolSegment.outputs).toHaveLength(1);
      expect(toolSegment.outputs[0].content).toBe('output content');
    });
  });
});
