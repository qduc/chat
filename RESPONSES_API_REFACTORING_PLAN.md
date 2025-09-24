# Responses API Migration Refactoring Plan

## Overview

This document outlines the architectural refactoring needed before implementing OpenAI's Responses API support. The current architecture has several flaws that would make the migration complex and error-prone. By addressing these issues first, we create a clean foundation for supporting multiple API formats.

## Current Architecture Problems

### 1. Mixed Responsibilities in Request Pipeline
- `openaiProxy.js` handles sanitization, strategy selection, orchestration, and persistence
- Adding Responses API would make this 400+ line function even more complex
- Violates Single Responsibility Principle

### 2. Shallow Provider Abstraction
- `OpenAIProvider` assumes Chat Completions format throughout
- Hard-coded message normalization and response structure expectations
- No clean way to support different API formats

### 3. Tool Orchestration Tightly Coupled
- `iterativeOrchestrator.js` and `unifiedToolOrchestrator.js` assume specific response structures
- Built around `choices[0].message.tool_calls` pattern
- Responses API has completely different tool execution model

### 4. Scattered Conversation State
- State management spread across multiple files
- No centralized way to track provider-specific state like `previous_response_id`
- Edit/regeneration logic assumes stateless interactions

## Refactoring Strategy

### Phase 1: Extract Request/Response Translation Layer

#### 1.1 Create Adapter Infrastructure
**New Files:**
- `backend/src/lib/adapters/BaseAdapter.js`
- `backend/src/lib/adapters/ChatCompletionsAdapter.js`
- `backend/src/lib/adapters/ResponsesAPIAdapter.js`

```javascript
// BaseAdapter.js - Interface definition
export class BaseAdapter {
  translateRequest(internalRequest, context = {}) {
    throw new Error('translateRequest must be implemented');
  }

  translateResponse(providerResponse, context = {}) {
    throw new Error('translateResponse must be implemented');
  }

  translateStreamChunk(chunk, context = {}) {
    throw new Error('translateStreamChunk must be implemented');
  }
}
```

#### 1.2 Implement Chat Completions Adapter
Extract current logic from `OpenAIProvider` into dedicated adapter:
- Request sanitization and normalization
- Response structure mapping
- Streaming chunk translation
- Error handling patterns

#### 1.3 Implement Responses API Adapter
New adapter for OpenAI Responses API:
- Chat Completions → Responses API request translation
- Responses API → Chat Completions response translation
- Complex streaming event translation
- `previous_response_id` management

**Benefits:**
- Clean separation between API formats and business logic
- Easy to test adapters in isolation
- Future API format support becomes pluggable

### Phase 2: Redesign Provider Architecture

#### 2.1 Enhanced Provider Interface
**Modify:** `backend/src/lib/providers/BaseProvider.js`

```javascript
export class BaseProvider {
  constructor(config, settings = {}) {
    this.config = config;
    this.settings = settings;
    this.adapter = this.createAdapter();
  }

  createAdapter() {
    // Override in subclasses to return appropriate adapter
    throw new Error('createAdapter must be implemented');
  }

  async sendRequest(internalRequest, context = {}) {
    const translatedRequest = this.adapter.translateRequest(internalRequest, context);
    const providerResponse = await this.makeHttpRequest(translatedRequest);
    return this.adapter.translateResponse(providerResponse, context);
  }

  async streamRequest(internalRequest, context = {}) {
    // Similar pattern for streaming
  }
}
```

#### 2.2 Update OpenAI Provider
**Modify:** `backend/src/lib/providers/openaiProvider.js`

```javascript
export class OpenAIProvider extends BaseProvider {
  createAdapter() {
    if (this.shouldUseResponsesAPI()) {
      return new ResponsesAPIAdapter(this.config, this.settings);
    }
    return new ChatCompletionsAdapter(this.config, this.settings);
  }

  shouldUseResponsesAPI() {
    const baseUrl = this.baseUrl.toLowerCase();
    return baseUrl.includes('api.openai.com') && this.isResponsesAPIEnabled();
  }
}
```

**Benefits:**
- Providers become format-agnostic
- Easy to switch between API formats
- Clean testing surface

### Phase 3: Centralize Strategy Selection

#### 3.1 Extract Strategy Selection Logic
**New File:** `backend/src/lib/strategies/RequestStrategy.js`

```javascript
export class RequestStrategy {
  static selectStrategy(request, provider, context = {}) {
    const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
    const isStreaming = request.stream === true;

    if (hasTools && isStreaming) return 'iterative-orchestration';
    if (hasTools && !isStreaming) return 'unified-orchestration';
    if (!hasTools && isStreaming) return 'streaming';
    return 'direct-proxy';
  }

  static getHandler(strategy) {
    const handlers = {
      'iterative-orchestration': handleIterativeOrchestration,
      'unified-orchestration': handleUnifiedToolOrchestration,
      'streaming': handleRegularStreaming,
      'direct-proxy': handleDirectProxy
    };
    return handlers[strategy];
  }
}
```

#### 3.2 Simplify Main Proxy Function
**Modify:** `backend/src/lib/openaiProxy.js`

```javascript
export async function proxyOpenAIRequest(req, res) {
  try {
    // Provider setup
    const providerId = req.body.provider_id || req.header('x-provider-id');
    const provider = await createProvider(config, { providerId });

    // Request preparation
    const context = {
      sessionId: req.sessionId,
      conversationId: req.body.conversation_id,
      req, res
    };

    const sanitizedRequest = sanitizeIncomingBody(req.body);

    // Strategy selection and execution
    const strategy = RequestStrategy.selectStrategy(sanitizedRequest, provider, context);
    const handler = RequestStrategy.getHandler(strategy);

    return await handler(sanitizedRequest, provider, context);

  } catch (error) {
    handleProxyError(error, res);
  }
}
```

**Benefits:**
- Single responsibility for main proxy function
- Strategy logic is testable and reusable
- Clean separation of concerns

### Phase 4: Unified State Management

#### 4.1 Create Conversation State Manager
**New File:** `backend/src/lib/state/ConversationStateManager.js`

```javascript
export class ConversationStateManager {
  constructor(db) {
    this.db = db;
  }

  getProviderState(conversationId, providerId, sessionId) {
    // Retrieve provider-specific state (like previous_response_id)
    return this.db.prepare(`
      SELECT provider_state FROM conversation_provider_state
      WHERE conversation_id = ? AND provider_id = ? AND session_id = ?
    `).get(conversationId, providerId, sessionId);
  }

  updateProviderState(conversationId, providerId, sessionId, state) {
    // Store provider-specific state
    this.db.prepare(`
      INSERT OR REPLACE INTO conversation_provider_state
      (conversation_id, provider_id, session_id, provider_state, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(conversationId, providerId, sessionId, JSON.stringify(state), new Date().toISOString());
  }

  handleMessageEdit(conversationId, messageId, sessionId) {
    // Clear provider state after edits (forces fresh context)
    this.db.prepare(`
      DELETE FROM conversation_provider_state
      WHERE conversation_id = ? AND session_id = ?
    `).run(conversationId, sessionId);
  }
}
```

#### 4.2 Add Database Schema
**New Migration:** `backend/src/db/migrations/004-provider-state.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_provider_state (
      conversation_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider_state TEXT NOT NULL, -- JSON blob
      updated_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, provider_id, session_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
}
```

#### 4.3 Integration Points
**Modify:** `backend/src/lib/adapters/ResponsesAPIAdapter.js`

```javascript
export class ResponsesAPIAdapter extends BaseAdapter {
  constructor(config, settings, stateManager) {
    super(config, settings);
    this.stateManager = stateManager;
  }

  translateRequest(internalRequest, context = {}) {
    const { conversationId, sessionId, providerId } = context;

    // Get previous_response_id from state
    const state = this.stateManager.getProviderState(conversationId, providerId, sessionId);
    const previousResponseId = state?.provider_state?.previous_response_id;

    return {
      model: internalRequest.model,
      input: internalRequest.messages,
      previous_response_id: previousResponseId,
      instructions: this.extractSystemMessage(internalRequest.messages),
      store: true // Enable server-side state
    };
  }

  translateResponse(providerResponse, context = {}) {
    // Store new response_id for next request
    const { conversationId, sessionId, providerId } = context;
    this.stateManager.updateProviderState(conversationId, providerId, sessionId, {
      previous_response_id: providerResponse.id
    });

    // Translate to Chat Completions format
    return this.convertToCompletionsFormat(providerResponse);
  }
}
```

**Benefits:**
- Centralized state management
- Provider-agnostic state tracking
- Clean handling of edit/regeneration scenarios

### Phase 5: Tool System Abstraction

#### 5.1 Create Tool Execution Interface
**New File:** `backend/src/lib/tools/ToolExecutor.js`

```javascript
export class ToolExecutor {
  constructor(provider, stateManager) {
    this.provider = provider;
    this.stateManager = stateManager;
  }

  async executeTools(request, context) {
    // Provider-agnostic tool execution
    if (this.provider.hasNativeToolSupport()) {
      return this.executeNativeTools(request, context);
    }
    return this.executeCustomTools(request, context);
  }

  async executeNativeTools(request, context) {
    // Let provider handle tools directly (Responses API)
    return this.provider.sendRequest(request, context);
  }

  async executeCustomTools(request, context) {
    // Use existing orchestration logic (Chat Completions)
    const strategy = request.stream ? 'iterative' : 'unified';
    return this.runOrchestration(strategy, request, context);
  }
}
```

#### 5.2 Update Orchestrators
**Modify:** Tool orchestrators to work with the new abstraction:
- Accept provider and context objects
- Use provider-agnostic response handling
- Delegate format-specific logic to adapters

**Benefits:**
- Tool system becomes provider-agnostic
- Native tool support can be leveraged when available
- Existing custom tools continue to work

## Implementation Timeline

### Week 1: Foundation
- [ ] Create adapter infrastructure and base classes
- [ ] Implement ChatCompletionsAdapter with existing logic
- [ ] Add comprehensive tests for adapter layer

### Week 2: Provider Refactoring
- [ ] Redesign BaseProvider and OpenAIProvider
- [ ] Extract strategy selection logic
- [ ] Refactor main proxy function

### Week 3: State Management
- [ ] Create ConversationStateManager
- [ ] Add database migration and schema
- [ ] Update conversation edit/regeneration logic

### Week 4: Tool System
- [ ] Create ToolExecutor abstraction
- [ ] Update orchestrators to use new patterns
- [ ] Integration testing across tool scenarios

### Week 5: Responses API Implementation
- [ ] Implement ResponsesAPIAdapter
- [ ] Add provider detection logic
- [ ] Stream translation implementation

### Week 6: Integration & Testing
- [ ] End-to-end testing with both API formats
- [ ] Performance testing and optimization
- [ ] Fallback mechanism implementation

## Testing Strategy

### Unit Tests
- **Adapters**: Test request/response translation in isolation
- **Providers**: Mock HTTP calls, test adapter selection
- **State Manager**: Database operations and state transitions
- **Strategy Selection**: Various request configurations

### Integration Tests
- **Dual Format Support**: Same conversation across both API formats
- **Tool Execution**: Custom and native tool scenarios
- **Edit/Regeneration**: State management edge cases
- **Provider Switching**: Mid-conversation provider changes

### Performance Tests
- **Memory Usage**: Adapter overhead and state storage
- **Latency**: Translation layer performance impact
- **Streaming**: Event translation efficiency

## Rollout Strategy

### Phase 1: Feature Flag
```javascript
// Environment variable to control Responses API usage
RESPONSES_API_ENABLED=false // Default off
```

### Phase 2: Gradual Rollout
- Enable for specific models first (gpt-4o, o1-preview)
- Monitor error rates and performance metrics
- A/B testing between API formats

### Phase 3: Full Migration
- Default to Responses API for supported models
- Keep Chat Completions as fallback
- Remove feature flag after stability confirmed

## Success Metrics

### Technical Metrics
- Zero regressions in existing functionality
- <10ms latency overhead from adapter layer
- 100% test coverage for new abstractions
- Clean separation of concerns (measured by coupling metrics)

### Business Metrics
- Improved conversation quality (subjective user feedback)
- Better context retention across message regenerations
- Reduced API costs (if Responses API is more efficient)

## Risk Mitigation

### Rollback Plan
- Feature flag allows instant rollback to Chat Completions
- Database migrations are additive (no data loss)
- Adapter pattern allows removing Responses API support cleanly

### Monitoring
- Detailed logging for adapter translation steps
- Performance monitoring for each layer
- Error tracking with provider and format context

### Backward Compatibility
- All existing API endpoints remain unchanged
- Frontend requires no modifications
- Existing conversations continue to work seamlessly

## Conclusion

This refactoring plan addresses the core architectural issues that would make Responses API migration difficult. By implementing clean abstractions and separation of concerns first, we create a foundation that:

1. **Simplifies the Responses API implementation**
2. **Improves maintainability of the existing codebase**
3. **Enables future provider and format support**
4. **Maintains backward compatibility and stability**

The phased approach allows for incremental progress with testing and validation at each step, reducing the risk of introducing regressions while enabling the powerful capabilities of OpenAI's Responses API.