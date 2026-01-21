import { Router } from 'express';
import { proxyOpenAIRequest } from '../lib/openaiProxy.js';
import { generateOpenAIToolSpecs, getAvailableTools } from '../lib/tools.js';
import { logger } from '../logger.js';
import { abortStream } from '../lib/streamAbortRegistry.js';
import { authenticateToken } from '../middleware/auth.js';
import { getUserSetting } from '../db/userSettings.js';

export const chatRouter = Router();

// Require authentication for all chat routes
chatRouter.use(authenticateToken);

chatRouter.post('/v1/chat/completions', proxyOpenAIRequest);

chatRouter.post('/v1/chat/completions/stop', (req, res) => {
  const requestId = req.body?.request_id || req.header('x-client-request-id');
  if (!requestId) {
    return res.status(400).json({ error: 'missing_request_id' });
  }

  const stopped = abortStream(requestId, req.user?.id);
  return res.json({ stopped });
});

// Tool specifications endpoint
chatRouter.get('/v1/tools', (req, res) => {
  try {
    const specs = generateOpenAIToolSpecs();
    const availableTools = getAvailableTools();
    const userId = req.user?.id;

    // Check API key status for tools that require them
    const toolApiKeyStatus = {};

    // Define which tools require which API keys
    const toolApiKeyMapping = {
      web_search: { settingKey: 'tavily_api_key', label: 'Tavily API Key' },
      web_search_exa: { settingKey: 'exa_api_key', label: 'Exa API Key' },
      web_search_searxng: { settingKey: 'searxng_base_url', label: 'SearXNG Base URL' },
      web_search_firecrawl: { settingKey: 'firecrawl_api_key', label: 'Firecrawl API Key' },
    };

    // Check each tool's API key status
    for (const toolName of availableTools) {
      const apiKeyInfo = toolApiKeyMapping[toolName];

      if (apiKeyInfo) {
        let hasKey = false;

        // Check user-specific setting first
        if (userId) {
          try {
            const userSetting = getUserSetting(userId, apiKeyInfo.settingKey);
            if (userSetting && userSetting.value) {
              hasKey = true;
            }
          } catch (err) {
            logger.warn('Failed to check user setting for tool', {
              toolName,
              userId,
              settingKey: apiKeyInfo.settingKey,
              err: err?.message
            });
          }
        }

        // Special case for firecrawl: allow if custom base URL is set (may be self-hosted)
        if (toolName === 'web_search_firecrawl' && !hasKey && userId) {
          try {
            const baseUrlSetting = getUserSetting(userId, 'firecrawl_base_url');
            if (baseUrlSetting && baseUrlSetting.value && baseUrlSetting.value !== 'https://api.firecrawl.dev') {
              hasKey = true;
            }
          } catch (err) {
            // ignore
          }
        }

        toolApiKeyStatus[toolName] = {
          hasApiKey: hasKey,
          requiresApiKey: true,
          missingKeyLabel: apiKeyInfo.label
        };
      } else {
        // Tool doesn't require an API key
        toolApiKeyStatus[toolName] = {
          hasApiKey: true,
          requiresApiKey: false
        };
      }
    }

    res.json({
      tools: specs,
      available_tools: availableTools,
      tool_api_key_status: toolApiKeyStatus
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
