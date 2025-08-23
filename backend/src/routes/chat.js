import { Router } from 'express';
import { proxyOpenAIRequest } from '../lib/openaiProxy.js';

export const chatRouter = Router();

// Support both APIs - Responses API is the primary endpoint
chatRouter.post('/v1/responses', proxyOpenAIRequest);
chatRouter.post('/v1/chat/completions', proxyOpenAIRequest);
