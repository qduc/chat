import { handleToolOrchestration } from './toolOrchestrator.js';
import { handleIterativeOrchestration } from './iterativeOrchestrator.js';
import { handleStreamingWithTools, setupStreamingHeaders } from './streamingHandler.js';

export async function routeToolOrchestration({
  apiFormat,
  body,
  bodyIn,
  config,
  res,
  req,
  stream,
  persistenceContext
}) {
  if (!apiFormat.hasTools) {
    return null; // No tools, continue with regular flow
  }

  // Handle non-streaming tool orchestration
  if (!stream) {
    return await handleToolOrchestration({
      body,
      bodyIn,
      config,
      res,
      persist: persistenceContext.persist,
      assistantMessageId: persistenceContext.assistantMessageId,
      appendAssistantContent: persistenceContext.appendAssistantContent,
      finalizeAssistantMessage: persistenceContext.finalizeAssistantMessage,
    });
  }

  // Handle streaming tool orchestration
  setupStreamingHeaders(res);
  
  if (apiFormat.useIterativeOrchestration) {
    return await handleIterativeOrchestration({
      body,
      bodyIn,
      config,
      res,
      req,
      persist: persistenceContext.persist,
      assistantMessageId: persistenceContext.assistantMessageId,
      appendAssistantContent: persistenceContext.appendAssistantContent,
      finalizeAssistantMessage: persistenceContext.finalizeAssistantMessage,
      markAssistantError: persistenceContext.markAssistantError,
      buffer: persistenceContext.buffer,
      flushedOnce: persistenceContext.flushedOnce,
      sizeThreshold: persistenceContext.sizeThreshold,
    });
  } else {
    return await handleStreamingWithTools({
      body,
      bodyIn,
      config,
      res,
      req,
      persist: persistenceContext.persist,
      assistantMessageId: persistenceContext.assistantMessageId,
      appendAssistantContent: persistenceContext.appendAssistantContent,
      finalizeAssistantMessage: persistenceContext.finalizeAssistantMessage,
      markAssistantError: persistenceContext.markAssistantError,
      buffer: persistenceContext.buffer,
      flushedOnce: persistenceContext.flushedOnce,
      sizeThreshold: persistenceContext.sizeThreshold,
    });
  }
}