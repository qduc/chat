/**
 * Tests for API client functions
 * @jest-environment jsdom
 *
 * Complements lib.chat.test.ts with additional coverage for:
 * - auth API functions
 * - image/file uploads
 * - tools and providers
 * - judge API
 */

import type { Role } from '../lib/types';
import { auth, chat, conversations, images, files, tools, providers, judge } from '../lib/api';
import { APIError, StreamingNotSupportedError } from '../lib/streaming';
import * as storage from '../lib/storage';

// Mock storage functions
jest.mock('../lib/storage', () => {
  const actual = jest.requireActual('../lib/storage');
  return {
    ...actual,
    getToken: jest.fn(() => 'test-token'),
    setToken: jest.fn(),
    setRefreshToken: jest.fn(),
    getRefreshToken: jest.fn(() => 'test-refresh-token'),
    clearTokens: jest.fn(),
    waitForAuthReady: jest.fn(() => Promise.resolve()),
  };
});

// Mock URL.createObjectURL and URL.revokeObjectURL (not available in JSDOM)
const mockCreateObjectURL = jest.fn((obj: Blob | MediaSource) => `blob:mock-url-${Date.now()}`);
const mockRevokeObjectURL = jest.fn();
Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

const encoder = new TextEncoder();
function sseStream(lines: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function createJsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSSEResponse(lines: string[]) {
  return new Response(sseStream(lines), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('auth API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register', () => {
    it('registers a new user and stores tokens', async () => {
      const mockResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test User',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResponse));

      const result = await auth.register('test@example.com', 'password123', 'Test User');

      expect(result.user.email).toBe('test@example.com');
      expect(storage.setToken).toHaveBeenCalledWith('access-token');
      expect(storage.setRefreshToken).toHaveBeenCalledWith('refresh-token');
    });

    it('throws error on registration failure', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ message: 'Email already exists' }, 400));

      await expect(auth.register('test@example.com', 'pass', 'Name')).rejects.toThrow(
        'Email already exists'
      );
    });
  });

  describe('login', () => {
    it('logs in user and stores tokens', async () => {
      const mockResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
        user: {
          id: 'user-1',
          email: 'test@example.com',
        },
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResponse));

      const result = await auth.login('test@example.com', 'password123');

      expect(result.user.email).toBe('test@example.com');
      expect(storage.setToken).toHaveBeenCalledWith('access-token');
    });

    it('throws error on invalid credentials', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ message: 'Invalid credentials' }, 401));

      await expect(auth.login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('logout', () => {
    it('clears tokens and notifies server', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse({}));

      await auth.logout();

      expect(storage.clearTokens).toHaveBeenCalled();
    });

    it('clears tokens even if server request fails', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await auth.logout();

      expect(storage.clearTokens).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('returns user profile', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        displayName: 'Test User',
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse({ user: mockUser }));

      const result = await auth.getProfile();

      expect(result.email).toBe('test@example.com');
      expect(result.displayName).toBe('Test User');
    });
  });

  describe('verifySession', () => {
    it('returns valid result when session is valid', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse({ user: mockUser }));

      const result = await auth.verifySession();

      expect(result.valid).toBe(true);
      expect(result.user?.email).toBe('test@example.com');
    });

    it('returns missing-token when no token exists', async () => {
      (storage.getToken as jest.Mock).mockReturnValueOnce(null);

      const result = await auth.verifySession();

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('missing-token');
    });

    it('returns expired reason on auth error', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Token expired'));

      const result = await auth.verifySession();

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('returns network reason on network error', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network failure'));

      const result = await auth.verifySession();

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('network');
    });
  });

  describe('electronLogin', () => {
    it('performs electron auto-login', async () => {
      const mockResponse = {
        tokens: {
          accessToken: 'electron-token',
          refreshToken: 'electron-refresh',
        },
        user: {
          id: 'user-1',
          email: 'electron@example.com',
        },
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResponse));

      const result = await auth.electronLogin();

      expect(result.user.email).toBe('electron@example.com');
      expect(storage.setToken).toHaveBeenCalledWith('electron-token');
    });
  });
});

describe('chat API - streaming events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles tool call events', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","function":{"name":"search","arguments":"{\\"query\\":\\"test\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const events: any[] = [];
    await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
      onEvent: (event) => events.push(event),
    });

    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent.value.function.name).toBe('search');
  });

  it('handles tool output events', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"tc-1","content":"result"}}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const events: any[] = [];
    await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
      onEvent: (event) => events.push(event),
    });

    const outputEvent = events.find((e) => e.type === 'tool_output');
    expect(outputEvent).toBeDefined();
  });

  it('handles usage events', async () => {
    const lines = [
      'data: {"usage":{"prompt_tokens":100,"completion_tokens":50},"model":"gpt-4"}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const events: any[] = [];
    await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
      onEvent: (event) => events.push(event),
    });

    const usageEvent = events.find((e) => e.type === 'usage');
    expect(usageEvent).toBeDefined();
    expect(usageEvent.value.prompt_tokens).toBe(100);
    expect(usageEvent.value.completion_tokens).toBe(50);
  });

  it('handles conversation metadata in stream', async () => {
    const lines = [
      'data: {"_conversation":{"id":"conv-1","title":"Test Chat","model":"gpt-4","created_at":"2024-01-01","tools_enabled":true}}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
    });

    expect(result.conversation?.id).toBe('conv-1');
    expect(result.conversation?.title).toBe('Test Chat');
    expect(result.conversation?.tools_enabled).toBe(true);
  });

  it('handles reasoning summary in stream', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
      'data: {"reasoning_summary":"Here is how I thought about it"}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
    });

    expect(result.reasoning_summary).toBe('Here is how I thought about it');
  });

  it('handles generated images in stream', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"images":[{"image_url":{"url":"https://example.com/img.png"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

    const events: any[] = [];
    await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      providerId: 'test',
      onEvent: (event) => events.push(event),
    });

    const imageEvent = events.find((e) => e.type === 'generated_image');
    expect(imageEvent).toBeDefined();
    expect(imageEvent.value.image_url.url).toBe('https://example.com/img.png');
  });
});

describe('chat.stopMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends stop request', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse({ stopped: true }));

    const result = await chat.stopMessage({ requestId: 'req-123' });

    expect(result.stopped).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions/stop'),
      expect.any(Object)
    );
  });

  it('returns false for empty requestId', async () => {
    const result = await chat.stopMessage({ requestId: '' });
    expect(result.stopped).toBe(false);
  });
});

describe('conversations API - additional coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conversations.clearListCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('editMessage', () => {
    it('edits a message', async () => {
      const mockResult = {
        message: { id: 'msg-1', content: 'edited', role: 'user' },
        conversation: { id: 'conv-1' },
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResult));

      const result = await conversations.editMessage('conv-1', 'msg-1', 'edited content');

      expect(result.message.content).toBe('edited');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages/msg-1/edit'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('getLinked', () => {
    it('returns linked conversations', async () => {
      const mockResponse = {
        conversations: [
          { id: 'linked-1', title: 'Linked 1' },
          { id: 'linked-2', title: 'Linked 2' },
        ],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResponse));

      const result = await conversations.getLinked('parent-conv');

      expect(result.conversations).toHaveLength(2);
      expect(result.conversations[0].id).toBe('linked-1');
    });
  });

  describe('migrateFromSession', () => {
    it('migrates session conversations', async () => {
      const mockResponse = { migrated: 5, message: 'Successfully migrated' };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockResponse));

      const result = await conversations.migrateFromSession();

      expect(result.migrated).toBe(5);
      expect(result.message).toBe('Successfully migrated');
    });
  });

  describe('cache management', () => {
    it('clears list cache', async () => {
      // First call populates cache
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ items: [], next_cursor: null }));
      await conversations.list();

      // Clear cache
      conversations.clearListCache();

      // Second call should make new request
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ items: [], next_cursor: null }));
      await conversations.list();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('invalidates detail cache', async () => {
      // First call populates cache
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ id: 'conv-1', messages: [] }));
      await conversations.get('conv-1');

      // Invalidate
      conversations.invalidateDetailCache('conv-1');

      // Second call should make new request
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(createJsonResponse({ id: 'conv-1', messages: [] }));
      await conversations.get('conv-1');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});

describe('images API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getConfig', () => {
    it('returns image config', async () => {
      const mockConfig = {
        maxFileSize: 10485760,
        maxImagesPerMessage: 5,
        allowedFormats: ['jpg', 'png', 'gif', 'webp'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockConfig));

      const result = await images.getConfig();

      expect(result.maxFileSize).toBe(10485760);
      expect(result.allowedFormats).toContain('png');
    });
  });

  describe('validateImages', () => {
    it('validates images successfully', async () => {
      const config = {
        maxFileSize: 10485760,
        maxImagesPerMessage: 5,
        allowedFormats: ['jpg', 'png'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const file = new File(['test'], 'test.png', { type: 'image/png' });
      const result = await images.validateImages([file]);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects too many images', async () => {
      const config = {
        maxFileSize: 10485760,
        maxImagesPerMessage: 2,
        allowedFormats: ['jpg', 'png'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const files = [
        new File(['test'], 'test1.png', { type: 'image/png' }),
        new File(['test'], 'test2.png', { type: 'image/png' }),
        new File(['test'], 'test3.png', { type: 'image/png' }),
      ];

      const result = await images.validateImages(files);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Maximum 2 images');
    });

    it('rejects invalid file type', async () => {
      const config = {
        maxFileSize: 10485760,
        maxImagesPerMessage: 5,
        allowedFormats: ['jpg', 'png'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const file = new File(['test'], 'test.bmp', { type: 'image/bmp' });
      const result = await images.validateImages([file]);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Invalid file type');
    });

    it('rejects non-image files', async () => {
      const config = {
        maxFileSize: 10485760,
        maxImagesPerMessage: 5,
        allowedFormats: ['jpg', 'png'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const file = new File(['test'], 'test.png', { type: 'text/plain' });
      const result = await images.validateImages([file]);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Not a valid image');
    });
  });

  describe('createPreviewUrl / revokePreviewUrl', () => {
    it('creates and revokes blob URLs', () => {
      const file = new File(['test'], 'test.png', { type: 'image/png' });
      const url = images.createPreviewUrl(file);

      expect(url).toMatch(/^blob:/);

      // Should not throw
      images.revokePreviewUrl(url);
    });

    it('ignores non-blob URLs when revoking', () => {
      // Should not throw
      images.revokePreviewUrl('https://example.com/img.png');
    });
  });

  describe('attachmentToImageContent', () => {
    it('converts attachment to OpenAI image content format', () => {
      const attachment = {
        id: 'img-1',
        url: 'https://example.com/img.png',
        name: 'test.png',
        size: 1000,
        type: 'image/png',
      };

      const content = images.attachmentToImageContent(attachment as any);

      expect(content.type).toBe('image_url');
      expect(content.image_url.url).toBe('https://example.com/img.png');
      expect(content.image_url.detail).toBe('auto');
    });

    it('uses custom detail level', () => {
      const attachment = {
        id: 'img-1',
        url: 'https://example.com/img.png',
      };

      const content = images.attachmentToImageContent(attachment as any, 'high');

      expect(content.image_url.detail).toBe('high');
    });
  });
});

describe('files API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getConfig', () => {
    it('returns file config', async () => {
      const mockConfig = {
        maxFileSize: 5242880,
        maxFilesPerMessage: 3,
        allowedExtensions: ['txt', 'js', 'py'],
        allowedMimeTypes: ['text/plain', 'application/javascript'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockConfig));

      const result = await files.getConfig();

      expect(result.maxFileSize).toBe(5242880);
      expect(result.allowedExtensions).toContain('txt');
    });
  });

  describe('validateFiles', () => {
    it('validates files successfully', async () => {
      const config = {
        maxFileSize: 5242880,
        maxFilesPerMessage: 3,
        allowedExtensions: ['txt', 'js'],
        allowedMimeTypes: ['text/plain'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const result = await files.validateFiles([file]);

      expect(result.isValid).toBe(true);
    });

    it('rejects too many files', async () => {
      const config = {
        maxFileSize: 5242880,
        maxFilesPerMessage: 2,
        allowedExtensions: ['txt'],
        allowedMimeTypes: ['text/plain'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const testFiles = [
        new File(['a'], 'a.txt', { type: 'text/plain' }),
        new File(['b'], 'b.txt', { type: 'text/plain' }),
        new File(['c'], 'c.txt', { type: 'text/plain' }),
      ];

      const result = await files.validateFiles(testFiles);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Maximum 2 files');
    });

    it('warns for unknown extensions', async () => {
      const config = {
        maxFileSize: 5242880,
        maxFilesPerMessage: 3,
        allowedExtensions: ['txt', 'js'],
        allowedMimeTypes: ['text/plain'],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(config));

      const file = new File(['test'], 'test.xyz', { type: 'text/plain' });
      const result = await files.validateFiles([file]);

      expect(result.isValid).toBe(true); // Still valid, just warning
      expect(result.warnings?.[0]).toContain('.xyz');
    });
  });
});

describe('tools API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns tool specs', async () => {
    const mockTools = {
      tools: [
        { name: 'search', description: 'Search the web' },
        { name: 'calculate', description: 'Perform calculations' },
      ],
    };

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockTools));

    const result = await tools.getToolSpecs();

    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe('search');
  });
});

describe('providers API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    providers.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getDefaultProviderId', () => {
    it('returns first enabled provider', async () => {
      const mockProviders = {
        providers: [
          { id: 'provider-1', enabled: 1, updated_at: '2024-01-01' },
          { id: 'provider-2', enabled: 1, updated_at: '2024-01-02' },
        ],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockProviders));

      const result = await providers.getDefaultProviderId();

      // Should return most recently updated
      expect(result).toBe('provider-2');
    });

    it('caches the result', async () => {
      const mockProviders = {
        providers: [{ id: 'provider-1', enabled: 1, updated_at: '2024-01-01' }],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockProviders));

      await providers.getDefaultProviderId();
      await providers.getDefaultProviderId();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('throws when no enabled providers', async () => {
      const mockProviders = {
        providers: [{ id: 'provider-1', enabled: 0, updated_at: '2024-01-01' }],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse(mockProviders));

      await expect(providers.getDefaultProviderId()).rejects.toThrow(
        'Unable to determine default provider'
      );
    });
  });
});

describe('judge API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('evaluate', () => {
    it('evaluates models and returns evaluation', async () => {
      const lines = [
        'data: {"type":"evaluation","evaluation":{"id":"eval-1","winner":"model_a","score_a":8,"score_b":6,"reasoning":"Model A was better"}}\n\n',
        'data: [DONE]\n\n',
      ];

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

      const evaluations: any[] = [];
      const result = await judge.evaluate({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        models: [
          { modelId: 'model-a', conversationId: 'conv-a', messageId: 'msg-a' },
          { modelId: 'model-b', conversationId: 'conv-b', messageId: 'msg-b' },
        ],
        judgeModelId: 'gpt-4',
        onEvaluation: (e) => evaluations.push(e),
      });

      expect(result.winner).toBe('model_a');
      expect(result.score_a).toBe(8);
      expect(evaluations).toHaveLength(1);
    });

    it('streams tokens during evaluation', async () => {
      const lines = [
        'data: {"choices":[{"delta":{"content":"Model A"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" is better"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(lines));

      const tokens: string[] = [];
      await judge.evaluate({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        models: [{ modelId: 'model-a', conversationId: 'conv-a', messageId: 'msg-a' }],
        judgeModelId: 'gpt-4',
        onToken: (t) => tokens.push(t),
      });

      expect(tokens.join('')).toBe('Model A is better');
    });
  });

  describe('deleteEvaluation', () => {
    it('deletes an evaluation', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(createJsonResponse({}));

      await judge.deleteEvaluation('eval-1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/judge/eval-1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
