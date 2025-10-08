# Reasoning Blocks Implementation Plan

## Overview
This plan addresses the gaps between ChatForge's current reasoning implementation and OpenRouter's requirements for preserving and replaying reasoning blocks throughout conversation lifecycles.

## Current State
- Reasoning controls (`reasoning_effort`) are forwarded correctly
- Frontend streams `<thinking>` tags for reasoning content
- Structured `reasoning_details` arrays are dropped during response transformation
- Persistence only stores concatenated text, not structured blocks
- History replay omits reasoning sequences

## Goals
1. Preserve `reasoning_details` arrays end-to-end (streaming and non-streaming)
2. Persist structured reasoning blocks in database
3. Replay reasoning blocks when rebuilding conversation history
4. Surface `reasoning_tokens` usage metrics to UI

---

## Implementation Tasks

### Phase 1: Database Schema & Persistence

#### 1.1 Extend Database Schema
**File**: `backend/scripts/migrations/`

Create new migration to add reasoning support:
- Add `reasoning_details` column to `messages` table (JSON type)
- Add `reasoning_tokens` column to track usage (INTEGER)
- Ensure backward compatibility with existing messages (nullable columns)

**Acceptance Criteria**:
- Migration applies cleanly on existing databases
- Existing messages remain accessible
- Schema supports array of reasoning detail objects

#### 1.2 Update Message Persistence Layer
**Files**:
- `backend/src/lib/conversation-manager.js` (or similar persistence module)
- Message creation/update functions

Changes:
- Store `reasoning_details` array when saving assistant messages
- Store `reasoning_tokens` count alongside prompt/completion tokens
- Retrieve reasoning blocks when loading conversation history

**Acceptance Criteria**:
- Assistant messages with reasoning_details are persisted correctly
- Reasoning blocks retrieved match original structure
- Legacy messages without reasoning continue to work

---

### Phase 2: Backend Response Handling

#### 2.1 Update Response Adapters (Non-Streaming)
**Files**:
- `backend/src/lib/adapters/responsesApiAdapter.js`
- `backend/src/lib/adapters/toChatCompletionResponse.js`

Changes:
- Preserve `choices[].message.reasoning_details` from upstream responses
- Extract and include `reasoning_tokens` from usage metadata
- Map reasoning_details to internal message format

**Acceptance Criteria**:
- Non-streaming responses include `reasoning_details` array
- Usage object contains `reasoning_tokens` when present
- Backward compatibility maintained for responses without reasoning

#### 2.2 Update Streaming Transformers
**Files**:
- `backend/src/lib/streaming/` (streaming transformer modules)
- Delta handling logic for SSE events

Changes:
- Capture `delta.reasoning_content` chunks from upstream
- Assemble complete `reasoning_details` array as stream completes
- Emit reasoning chunks to frontend via SSE
- Include final `reasoning_details` in stream completion metadata

**Acceptance Criteria**:
- Streaming responses emit reasoning content progressively
- Final message includes complete `reasoning_details` array
- Reasoning tokens counted and reported in usage stats

---

### Phase 3: Conversation History Replay

#### 3.1 Update History Builder
**Files**:
- `backend/src/lib/conversation-manager.js` (history building functions)
- Request preparation logic before upstream API calls

Changes:
- When building message history for OpenRouter requests, attach `reasoning_details` to assistant messages
- Maintain exact order and structure of reasoning blocks
- Include reasoning blocks for tool call sequences

**Acceptance Criteria**:
- Outgoing requests to OpenRouter include original reasoning_details
- Multi-turn tool workflows preserve reasoning context
- Request format matches OpenRouter's expected schema

---

### Phase 4: Frontend Integration

#### 4.1 Update TypeScript Types
**Files**:
- `frontend/lib/chat/types.ts` (or relevant type definitions)
- Message and streaming event types

Changes:
- Add `reasoning_details` array to message interface
- Add `reasoning_tokens` to usage metadata type
- Define structured reasoning detail object type

**Acceptance Criteria**:
- Types match OpenRouter schema specification
- No TypeScript errors in existing code

#### 4.2 Update Streaming Client
**Files**:
- `frontend/lib/chat/client.ts`
- SSE event processing logic

Changes:
- Handle incoming `reasoning_details` from stream metadata
- Store reasoning blocks in message state
- Continue supporting `<thinking>` tag rendering for compatibility

**Acceptance Criteria**:
- Streaming messages capture reasoning_details
- UI displays reasoning content (tags as fallback)
- Non-streaming messages also show reasoning

#### 4.3 Update State Management
**Files**:
- `frontend/hooks/useChatState/types.ts`
- `frontend/hooks/useChatState/reducers/` (message reducers)

Changes:
- Extend message state to store `reasoning_details`
- Update reducers to preserve reasoning when updating messages
- Include reasoning in message serialization

**Acceptance Criteria**:
- State holds structured reasoning blocks
- State updates preserve reasoning data
- Message edits maintain reasoning context

#### 4.4 Enhance Usage Display
**Files**:
- `frontend/components/` (usage metrics components)
- Token usage display logic

Changes:
- Show `reasoning_tokens` alongside prompt/completion tokens
- Indicate when reasoning was used in a response
- Aggregate reasoning token costs in conversation totals

**Acceptance Criteria**:
- UI displays reasoning token counts when present
- Clear visual distinction between token types
- Costs properly attributed if billing integration exists

---

### Phase 5: Testing & Validation

#### 5.1 Backend Tests
**Files**:
- `backend/__tests__/reasoning-blocks.test.js` (new)
- Existing adapter and persistence tests

Test Cases:
- Reasoning details preserved in non-streaming responses
- Reasoning chunks assembled correctly during streaming
- Database roundtrip maintains reasoning structure
- History replay includes reasoning blocks
- Legacy messages without reasoning handled gracefully

#### 5.2 Frontend Tests
**Files**:
- `frontend/__tests__/reasoning-display.test.tsx` (new)
- State management tests

Test Cases:
- Reasoning details stored in state correctly
- UI renders reasoning content appropriately
- Usage metrics display reasoning tokens
- Streaming updates handle reasoning chunks

#### 5.3 Integration Tests
**Files**:
- End-to-end test suite

Test Scenarios:
- Complete conversation with reasoning blocks
- Multi-turn tool workflow with reasoning preservation
- Edit/regenerate maintains reasoning context
- Reasoning tokens reported accurately

---

## Migration Strategy

### Rollout Phases
1. **Database Migration**: Apply schema changes, verify backward compatibility
2. **Backend Persistence**: Deploy reasoning storage without breaking existing flows
3. **Response Handling**: Enable reasoning passthrough (non-breaking)
4. **History Replay**: Activate reasoning block replay for OpenRouter
5. **Frontend UI**: Surface reasoning data and usage metrics
6. **Monitoring**: Track reasoning token usage and validate data integrity

### Backward Compatibility
- All changes must support existing messages without reasoning
- Graceful degradation if upstream doesn't provide reasoning
- Existing `<thinking>` tag rendering remains functional
- No breaking changes to API contracts

### Rollback Plan
- Database migration includes down migration
- Feature flags to disable reasoning passthrough if issues arise
- Monitoring for increased error rates or data corruption

---

## Success Criteria

### Functional Requirements
- [ ] Reasoning details preserved from upstream API through to database
- [ ] Streaming and non-streaming responses both capture reasoning
- [ ] History replay includes reasoning blocks for tool workflows
- [ ] UI displays reasoning tokens in usage metrics
- [ ] No data loss or corruption during migration

### Performance Requirements
- [ ] No significant latency increase in response processing
- [ ] Database query performance remains acceptable
- [ ] Streaming throughput unaffected by reasoning capture

### Quality Requirements
- [ ] Test coverage >90% for new reasoning logic
- [ ] All linters pass (backend and frontend)
- [ ] TypeScript strict mode satisfied
- [ ] No console errors in production build

---

## Timeline Estimate

- **Phase 1** (Database): 1-2 days
- **Phase 2** (Backend): 2-3 days
- **Phase 3** (History): 1-2 days
- **Phase 4** (Frontend): 2-3 days
- **Phase 5** (Testing): 2-3 days
- **Buffer/Polish**: 1-2 days

**Total**: ~10-15 days

---

## Dependencies & Risks

### Dependencies
- OpenRouter API access for testing reasoning responses
- Understanding of current message schema and persistence layer
- Coordination with any ongoing conversation management refactors

### Risks
- **Schema Migration Complexity**: Existing large databases may require careful migration
  - *Mitigation*: Test migration on production-sized dataset copy
- **Streaming State Management**: Assembling reasoning chunks adds complexity
  - *Mitigation*: Reuse existing stream assembly patterns from content handling
- **API Schema Drift**: OpenRouter may update reasoning format
  - *Mitigation*: Version tolerance in parsing, comprehensive validation

---

## Open Questions

1. Should reasoning blocks be editable by users, or read-only?
2. Do we need reasoning visibility controls (show/hide in UI)?
3. Should reasoning content be searchable within conversations?
4. How should reasoning blocks be exported (if conversation export exists)?
5. Are there privacy implications for storing reasoning content?

---

## References

- OpenRouter Reasoning Tokens Guide
- `docs/reasoning-blocks-comparison.md`
- Backend message schema: `backend/scripts/migrations/`
- Frontend state types: `frontend/hooks/useChatState/types.ts`
