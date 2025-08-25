import fetch from 'node-fetch';
import { config } from '../env.js';
import { determineApiFormat, prepareRequestBody, buildUpstreamUrl, createHeaders } from './apiFormatHandler.js';
import { PersistenceManager } from './persistenceManager.js';
import { isStreamingResponse, handleNonStreamingResponse, setupStreaming } from './responseHandler.js';
import { routeToolOrchestration } from './orchestrationRouter.js';
import { handleRegularStreaming } from './streamingHandler.js';

export async function proxyOpenAIRequest(req, res) {
  const bodyIn = req.body || {};
  const conversationId = bodyIn.conversation_id || req.header('x-conversation-id');
  const sessionId = req.sessionId;
  
  // Determine API format and prepare request
  const apiFormat = determineApiFormat(bodyIn, config);
  const body = prepareRequestBody(bodyIn, apiFormat, config);
  const stream = !!body.stream;
  
  // Initialize persistence manager
  const persistenceManager = new PersistenceManager(config);
  
  try {
    // Setup persistence
    try {
      await persistenceManager.initialize({
        conversationId,
        sessionId,
        req,
        res,
        bodyIn,
      });
    } catch (error) {
      if (error.message === 'Message limit exceeded') {
        return; // Response already sent by persistence handler
      }
      throw error;
    }

    // Route tool orchestration if needed
    const toolResult = await routeToolOrchestration({
      apiFormat,
      body,
      bodyIn,
      config,
      res,
      req,
      stream,
      persistenceContext: persistenceManager.getStreamingContext(),
    });
    
    if (toolResult !== null) {
      return toolResult; // Tool orchestration handled the request
    }

    // Make upstream request
    const url = buildUpstreamUrl(apiFormat.useResponsesAPI, config);
    const headers = createHeaders(config);
    
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Handle non-streaming responses
    if (!isStreamingResponse(upstream, stream)) {
      const result = await handleNonStreamingResponse(
        upstream, 
        req, 
        apiFormat.useResponsesAPI, 
        persistenceManager
      );
      return res.status(result.status).json(result.response);
    }

    // Handle streaming responses
    setupStreaming(res);
    persistenceManager.setupStreamingTimer();
    
    const streamingContext = persistenceManager.getStreamingContext();
    
    return await handleRegularStreaming({
      upstream,
      res,
      req,
      ...streamingContext,
      useResponsesAPI: apiFormat.useResponsesAPI,
    });
    
  } catch (error) {
    console.error('[proxy] error', error);
    persistenceManager.markError();
    res.status(500).json({ 
      error: 'upstream_error', 
      message: error.message 
    });
  } finally {
    persistenceManager.cleanup();
  }
}
