import {
  setupPersistence,
  setupPersistenceTimer,
  handleNonStreamingPersistence,
  cleanupPersistenceTimer,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
} from './persistenceHandler.js';

export class PersistenceManager {
  constructor(config) {
    this.config = config;
    this.persist = false;
    this.assistantMessageId = null;
    this.buffer = { value: '' };
    this.flushedOnce = { value: false };
    this.flushTimer = null;
    this.sizeThreshold = 512;
    this.flushMs = config.persistence.historyBatchFlushMs;
  }

  async initialize({ conversationId, sessionId, req, res, bodyIn }) {
    try {
      const persistenceResult = await setupPersistence({
        config: this.config,
        conversationId,
        sessionId,
        req,
        res,
        bodyIn,
      });
      this.persist = persistenceResult.persist;
      this.assistantMessageId = persistenceResult.assistantMessageId;
    } catch (error) {
      if (error.message === 'Message limit exceeded') {
        throw error; // Let caller handle response
      }
      throw error;
    }
  }

  setupStreamingTimer() {
    if (!this.persist) return;

    this.flushTimer = setupPersistenceTimer({
      persist: this.persist,
      flushMs: this.flushMs,
      doFlush: () => {
        if (!this.persist || !this.assistantMessageId) return;
        if (this.buffer.value.length === 0) return;
        
        appendAssistantContent({
          messageId: this.assistantMessageId,
          delta: this.buffer.value,
        });
        this.buffer.value = '';
        this.flushedOnce.value = true;
      },
    });
  }

  handleNonStreaming({ content, finishReason }) {
    handleNonStreamingPersistence({
      persist: this.persist,
      assistantMessageId: this.assistantMessageId,
      content,
      finishReason,
    });
  }

  markError() {
    if (this.persist && this.assistantMessageId) {
      try {
        markAssistantError({ messageId: this.assistantMessageId });
      } catch {
        // Client disconnected; ignore
      }
    }
  }

  cleanup() {
    if (this.flushTimer) {
      cleanupPersistenceTimer(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getStreamingContext() {
    return {
      persist: this.persist,
      assistantMessageId: this.assistantMessageId,
      appendAssistantContent,
      finalizeAssistantMessage,
      markAssistantError,
      buffer: this.buffer,
      flushedOnce: this.flushedOnce,
      sizeThreshold: this.sizeThreshold,
    };
  }
}