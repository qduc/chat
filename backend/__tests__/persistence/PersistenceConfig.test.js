import assert from 'node:assert/strict';
import { PersistenceConfig } from '../../src/lib/persistence/PersistenceConfig.js';

describe('PersistenceConfig', () => {
  let config;
  const mockConfigData = {
    persistence: {
      enabled: true,
      maxConversationsPerSession: 50,
      maxMessagesPerConversation: 500,
    },
    defaultModel: 'gpt-4',
    titleModel: 'gpt-3.5-turbo',
  };

  beforeEach(() => {
    config = new PersistenceConfig(mockConfigData);
  });

  describe('constructor', () => {
    test('should create instance with valid config', () => {
      assert.ok(config instanceof PersistenceConfig);
      assert.equal(config.config, mockConfigData);
    });

    test('should throw error with no config', () => {
      assert.throws(() => new PersistenceConfig(), {
        message: 'Configuration is required for PersistenceConfig',
      });
    });
  });

  describe('isPersistenceEnabled', () => {
    test('should return true when enabled in config', () => {
      assert.equal(config.isPersistenceEnabled(), true);
    });

    test('should return false when disabled in config', () => {
      const disabledConfig = new PersistenceConfig({
        persistence: { enabled: false },
      });
      assert.equal(disabledConfig.isPersistenceEnabled(), false);
    });

    test('should return false when persistence config missing', () => {
      const noConfig = new PersistenceConfig({});
      assert.equal(noConfig.isPersistenceEnabled(), false);
    });
  });

  describe('getMaxConversationsPerSession', () => {
    test('should return configured value', () => {
      assert.equal(config.getMaxConversationsPerSession(), 50);
    });

    test('should return default value when not configured', () => {
      const defaultConfig = new PersistenceConfig({});
      assert.equal(defaultConfig.getMaxConversationsPerSession(), 100);
    });
  });

  describe('getMaxMessagesPerConversation', () => {
    test('should return configured value', () => {
      assert.equal(config.getMaxMessagesPerConversation(), 500);
    });

    test('should return default value when not configured', () => {
      const defaultConfig = new PersistenceConfig({});
      assert.equal(defaultConfig.getMaxMessagesPerConversation(), 1000);
    });
  });

  describe('extractRequestSettings', () => {
    test('should extract settings from OpenAI-compatible request', () => {
      const bodyIn = {
        model: 'gpt-4o',
        stream: true,
        tools: [{ type: 'function', function: { name: 'test' } }],
        systemPrompt: 'You are helpful',
        reasoning_effort: 'high',
      };

      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.model, 'gpt-4o');
      assert.equal(result.streamingEnabled, true);
      assert.equal(result.toolsEnabled, true);
      assert.equal(result.systemPrompt, 'You are helpful');
      assert.equal(result.reasoningEffort, 'high');
      assert.deepEqual(result.metadata, {
        system_prompt: 'You are helpful',
        active_tools: ['test']
      });
      assert.deepEqual(result.activeTools, ['test']);
    });

    test('should handle explicit persistence flags', () => {
      const bodyIn = {
        streamingEnabled: false,
        toolsEnabled: true,
        stream: true, // Should be overridden by streamingEnabled
        tools: [], // Should be overridden by toolsEnabled
      };

      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.streamingEnabled, false);
      assert.equal(result.toolsEnabled, true);
      assert.deepEqual(result.metadata.active_tools, []);
    });

    test('should fallback to default model', () => {
      const bodyIn = {};
      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.model, 'gpt-4');
      assert.deepEqual(result.metadata.active_tools, []);
    });

    test('should handle system_prompt field', () => {
      const bodyIn = {
        system_prompt: 'Alternative system prompt field',
      };

      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.systemPrompt, 'Alternative system prompt field');
      assert.deepEqual(result.metadata, {
        system_prompt: 'Alternative system prompt field',
        active_tools: []
      });
    });

    test('should preserve explicit null system prompt and active_system_prompt_id', () => {
      const bodyIn = {
        system_prompt: null,
        active_system_prompt_id: null,
      };

      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.systemPrompt, null);
      assert.equal(result.activeSystemPromptId, null);
      assert.equal(result.hasSystemPromptField, true);
      assert.equal(result.hasActiveSystemPromptIdField, true);
      assert.deepEqual(result.metadata, {
        system_prompt: null,
        active_system_prompt_id: null,
        active_tools: [],
      });
    });

    test('should treat empty system prompt string as explicit clear', () => {
      const bodyIn = {
        system_prompt: '   ',
      };

      const result = config.extractRequestSettings(bodyIn);

      assert.equal(result.systemPrompt, null);
      assert.equal(result.hasSystemPromptField, true);
      assert.deepEqual(result.metadata, {
        system_prompt: null,
        active_tools: [],
      });
    });
  });

  describe('extractProviderId', () => {
    test('should extract from body provider_id', () => {
      const bodyIn = { provider_id: 'test-provider' };
      const req = { header: () => null };

      const result = config.extractProviderId(bodyIn, req);

      assert.equal(result, 'test-provider');
    });

    test('should extract from header when body missing', () => {
      const bodyIn = {};
      const req = { header: (name) => name === 'x-provider-id' ? 'header-provider' : null };

      const result = config.extractProviderId(bodyIn, req);

      assert.equal(result, 'header-provider');
    });

    test('should return undefined when both missing', () => {
      const bodyIn = {};
      const req = { header: () => null };

      const result = config.extractProviderId(bodyIn, req);

      assert.equal(result, undefined);
    });
  });

  describe('filterNonSystemMessages', () => {
    test('should filter out system messages', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'system', content: 'Another system' },
      ];

      const result = config.filterNonSystemMessages(messages);

      assert.equal(result.length, 2);
      assert.equal(result[0].role, 'user');
      assert.equal(result[1].role, 'assistant');
    });

    test('should handle non-array input', () => {
      const result = config.filterNonSystemMessages(null);

      assert.deepEqual(result, []);
    });

    test('should handle invalid messages', () => {
      const messages = [null, undefined, { role: 'user', content: 'Valid' }, {}];

      const result = config.filterNonSystemMessages(messages);

      assert.equal(result.length, 2); // { role: 'user', content: 'Valid' } and {} both pass the truthy filter
      assert.equal(result[0].role, 'user');
    });
  });

  describe('checkMetadataUpdates', () => {
    test('should detect system prompt update needed', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Old prompt' },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(existingConvo, 'New prompt', 'same-provider', ['test']);

      assert.equal(result.needsSystemUpdate, true);
      assert.equal(result.needsProviderUpdate, false);
      assert.equal(result.systemPrompt, 'New prompt');
      assert.equal(result.needsActiveToolsUpdate, true);
      assert.deepEqual(result.activeTools, ['test']);
    });

    test('should detect provider update needed', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Same prompt' },
        providerId: 'old-provider',
      };

      const result = config.checkMetadataUpdates(existingConvo, 'Same prompt', 'new-provider', []);

      assert.equal(result.needsSystemUpdate, false);
      assert.equal(result.needsProviderUpdate, true);
      assert.equal(result.providerId, 'new-provider');
      assert.equal(result.needsActiveToolsUpdate, false);
    });

    test('should detect no updates needed', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Same prompt', active_tools: ['a'] },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(existingConvo, 'Same prompt', 'same-provider', ['a']);

      assert.equal(result.needsSystemUpdate, false);
      assert.equal(result.needsProviderUpdate, false);
      assert.equal(result.needsActiveToolsUpdate, false);
    });

    test('should handle missing metadata', () => {
      const existingConvo = { providerId: 'same-provider' };

      const result = config.checkMetadataUpdates(existingConvo, 'New prompt', 'same-provider', []);

      assert.equal(result.needsSystemUpdate, true);
      assert.equal(result.needsProviderUpdate, false);
      assert.equal(result.needsActiveToolsUpdate, false);
    });

    test('should detect active tools update when list changes', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Same prompt', active_tools: ['a', 'b'] },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(existingConvo, 'Same prompt', 'same-provider', ['a']);

      assert.equal(result.needsSystemUpdate, false);
      assert.equal(result.needsProviderUpdate, false);
      assert.equal(result.needsActiveToolsUpdate, true);
      assert.deepEqual(result.activeTools, ['a']);
    });

    test('should detect explicit null system prompt update', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Old prompt' },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(
        existingConvo,
        null,
        'same-provider',
        [],
        null,
        undefined,
        { hasSystemPromptField: true }
      );

      assert.equal(result.needsSystemUpdate, true);
      assert.equal(result.systemPrompt, null);
    });

    test('should detect active_system_prompt_id clear update', () => {
      const existingConvo = {
        metadata: { active_system_prompt_id: 'prompt-123' },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(
        existingConvo,
        null,
        'same-provider',
        [],
        null,
        undefined,
        { hasActiveSystemPromptIdField: true, activeSystemPromptId: null }
      );

      assert.equal(result.needsActiveSystemPromptIdUpdate, true);
      assert.equal(result.activeSystemPromptId, null);
    });

    test('should not update system prompt when field is omitted', () => {
      const existingConvo = {
        metadata: { system_prompt: 'Keep me' },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(
        existingConvo,
        null,
        'same-provider',
        [],
        null,
        undefined,
        { hasSystemPromptField: false }
      );

      assert.equal(result.needsSystemUpdate, false);
    });

    test('should not update active_system_prompt_id when field is omitted', () => {
      const existingConvo = {
        metadata: { active_system_prompt_id: 'prompt-123' },
        providerId: 'same-provider',
      };

      const result = config.checkMetadataUpdates(
        existingConvo,
        null,
        'same-provider',
        [],
        null,
        undefined,
        { hasActiveSystemPromptIdField: false }
      );

      assert.equal(result.needsActiveSystemPromptIdUpdate, false);
    });
  });
});
