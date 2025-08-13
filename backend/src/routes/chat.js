import { Router } from 'express';
import { proxyChatCompletion } from '../lib/openaiProxy.js';

export const chatRouter = Router();

chatRouter.post('/v1/chat/completions', proxyChatCompletion);
