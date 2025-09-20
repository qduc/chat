import { Router } from 'express';
import { proxyOpenAIRequest } from '../lib/openaiProxy.js';
import { generateOpenAIToolSpecs, getAvailableTools } from '../lib/tools.js';
import { logger } from '../logger.js';

export const chatRouter = Router();

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
    logger.error({
      msg: 'tool_specs_error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      req: {
        id: req.id,
        method: req.method,
        url: req.url,
      },
    });
    res.status(500).json({ error: 'Failed to generate tool specifications' });
  }
});
