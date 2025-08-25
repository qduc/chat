import { Router } from 'express';
import { proxyOpenAIRequest } from '../lib/openaiProxy.js';
import { generateOpenAIToolSpecs, getAvailableTools } from '../lib/tools.js';

export const chatRouter = Router();

// Support both APIs - Responses API is the primary endpoint
chatRouter.post('/v1/responses', proxyOpenAIRequest);
chatRouter.post('/v1/chat/completions', proxyOpenAIRequest);

// Tool specifications endpoint
chatRouter.get('/v1/tools', (req, res) => {
  try {
    const specs = generateOpenAIToolSpecs();
    const availableTools = getAvailableTools();
    
    res.json({
      tools: specs,
      available_tools: availableTools
    });
  } catch (error) {
    console.error('Error generating tool specs:', error);
    res.status(500).json({ error: 'Failed to generate tool specifications' });
  }
});
