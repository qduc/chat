import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { proxyOpenAIRequest } from '../lib/openaiProxy.js';
import { generateOpenAIToolSpecs, getAvailableTools } from '../lib/tools.js';
import { logger } from '../logger.js';
import { abortStream } from '../lib/streamAbortRegistry.js';
import { authenticateToken } from '../middleware/auth.js';
import { getUserSetting } from '../db/userSettings.js';
import { config } from '../env.js';
import { createOpenAIRequest, setupStreamingHeaders, writeAndFlush, createChatCompletionChunk } from '../lib/streamUtils.js';
import { parseSSEStream } from '../lib/sseParser.js';
import { getDb } from '../db/client.js';
import { getMessageContentByClientId, getPreviousUserMessage } from '../db/messages.js';
import {
  getEvaluationByPair,
  getEvaluationByModelSet,
  createEvaluation,
  deleteEvaluation,
} from '../db/evaluations.js';

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

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (typeof part === 'object') {
        if (typeof part.text === 'string') {
          parts.push(part.text);
          continue;
        }
        if (typeof part.value === 'string') {
          parts.push(part.value);
          continue;
        }
        if (typeof part.content === 'string') {
          parts.push(part.content);
        }
      }
    }
    return parts.join('');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.value === 'string') return content.value;
    if (typeof content.content === 'string') return content.content;
  }
  return String(content);
}

function buildJudgePrompt({ criteria, userPrompt, responses }) {
  const normalizedCriteria = typeof criteria === 'string' ? criteria.trim() : '';
  const criteriaText = normalizedCriteria
    ? `Criteria: ${normalizedCriteria}`
    : 'Criteria: General correctness and helpfulness.';
  const promptText = userPrompt?.trim() ? userPrompt.trim() : 'No explicit user prompt provided.';
  const responseBlocks = responses
    .map(({ label, content }) => {
      const responseText = content?.trim() ? content.trim() : '';
      return `${label} Response:\n${responseText}`;
    })
    .join('\n\n');
  const labelList = responses.map(({ label }) => label).join(', ');

  const system = `You are an impartial judge evaluating multiple AI responses.\n\n` +
    `${criteriaText}\n\n` +
    `You must return ONLY valid JSON with the following schema:\n` +
    `{\n` +
    `  "winner": string | "tie",\n` +
    `  "scores": { "<label>": number, ... },\n` +
    `  "reasoning": string\n` +
    `}\n\n` +
    `Use the exact response labels as keys in "scores" and for "winner".\n` +
    `Available labels: ${labelList}\n` +
    `Be thorough, cite concrete differences, and format the answer structured.\n` +
    `You can use markdown in the "reasoning" field to produce a structured, easy-to-read response with bold text, lists, or tables if needed.`;

  const user = `User Prompt:\n${promptText}\n\n` +
    `${responseBlocks}`;

  return {
    system,
    user,
  };
}

function resolveJudgeModel(rawModel, rawProviderId) {
  if (!rawModel || typeof rawModel !== 'string') {
    return { model: null, providerId: rawProviderId || undefined };
  }

  const trimmed = rawModel.trim();
  if (!trimmed) return { model: null, providerId: rawProviderId || undefined };
  if (trimmed.includes('::')) {
    const [provider, model] = trimmed.split('::', 2);
    return {
      model: model?.trim() || null,
      providerId: rawProviderId || provider?.trim() || undefined,
    };
  }
  return { model: trimmed, providerId: rawProviderId || undefined };
}

chatRouter.post('/v1/chat/judge', async (req, res) => {
  if (!config.persistence.enabled) {
    return res.status(501).json({ error: 'not_implemented' });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const {
    conversation_id,
    comparison_conversation_id,
    message_id,
    comparison_message_id,
    comparison_models,
    judge_model,
    judge_provider_id,
    criteria,
  } = req.body || {};

  const conversationId = conversation_id || null;
  const messageId = message_id || null;
  const normalizedCriteria = typeof criteria === 'string' ? criteria.trim() : '';

  if (!conversationId || !messageId) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'conversation_id and message_id are required',
    });
  }

  const requestedModels = Array.isArray(comparison_models) ? comparison_models : null;
  let comparisonModels = [];

  if (requestedModels && requestedModels.length > 0) {
    comparisonModels = requestedModels
      .map((model) => ({
        modelId: typeof model?.model_id === 'string' ? model.model_id.trim() : null,
        conversationId: typeof model?.conversation_id === 'string' ? model.conversation_id : null,
        messageId: typeof model?.message_id === 'string' ? model.message_id : null,
      }))
      .filter((model) => model.conversationId && model.messageId);
  } else if (comparison_conversation_id && comparison_message_id) {
    comparisonModels = [
      {
        modelId: null,
        conversationId: comparison_conversation_id,
        messageId: comparison_message_id,
      },
    ];
  }

  if (!comparisonModels.length) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'comparison_models (or comparison_conversation_id/comparison_message_id) is required',
    });
  }

  const { model: judgeModelId, providerId: judgeProviderId } = resolveJudgeModel(
    judge_model,
    judge_provider_id
  );

  if (!judgeModelId) {
    return res.status(400).json({ error: 'bad_request', message: 'judge_model is required' });
  }

  try {
    getDb();

    const comparisonLabelModels = comparisonModels.map((model, index) => ({
      ...model,
      label: model.modelId?.trim() || `model_${index + 1}`,
    }));

    const modelSet = [
      { modelId: 'primary', conversationId, messageId },
      ...comparisonLabelModels.map((model) => ({
        modelId: model.label,
        conversationId: model.conversationId,
        messageId: model.messageId,
      })),
    ];
    const existing =
      comparisonModels.length === 1
        ? getEvaluationByPair({
            userId,
            conversationId,
            modelAConversationId: conversationId,
            modelAMessageId: messageId,
            modelBConversationId: comparisonModels[0].conversationId,
            modelBMessageId: comparisonModels[0].messageId,
            judgeModelId,
            criteria: normalizedCriteria || null,
          })
        : getEvaluationByModelSet({
            userId,
            conversationId,
            judgeModelId,
            criteria: normalizedCriteria || null,
            models: modelSet,
          });

    if (existing) {
      setupStreamingHeaders(res);
      writeAndFlush(res, `data: ${JSON.stringify({ type: 'evaluation', evaluation: existing })}\n\n`);
      writeAndFlush(res, 'data: [DONE]\n\n');
      return res.end();
    }

    const messageA = getMessageContentByClientId({
      conversationId,
      clientMessageId: messageId,
      userId,
    });

    if (!messageA) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Primary message not found for evaluation',
      });
    }

    const comparisonMessages = comparisonLabelModels.map((model) => ({
      ...model,
      message: getMessageContentByClientId({
        conversationId: model.conversationId,
        clientMessageId: model.messageId,
        userId,
      }),
    }));

    const missingComparison = comparisonMessages.find((model) => !model.message);
    if (missingComparison) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Comparison messages not found for evaluation',
      });
    }

    const promptMessage = getPreviousUserMessage({
      conversationId,
      beforeSeq: messageA.seq,
      userId,
    });

    const responseA = extractTextFromContent(messageA.content);
    const userPrompt = promptMessage ? extractTextFromContent(promptMessage.content) : '';

    const responseLabels = comparisonMessages.map((model) => ({
      label: model.label,
      modelId: model.modelId?.trim() || null,
      conversationId: model.conversationId,
      messageId: model.messageId,
      content: extractTextFromContent(model.message.content),
    }));

    const prompt = buildJudgePrompt({
      criteria,
      userPrompt,
      responses: [
        { label: 'primary', content: responseA },
        ...responseLabels.map((model) => ({ label: model.label, content: model.content })),
      ],
    });

    const requestBody = {
      model: judgeModelId,
      stream: true,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };

    const upstream = await createOpenAIRequest(config, requestBody, {
      providerId: judgeProviderId,
    });

    if (!upstream.ok) {
      let errorBody;
      try {
        errorBody = await upstream.json();
      } catch {
        errorBody = { error: 'upstream_error', message: await upstream.text() };
      }
      return res.status(upstream.status || 500).json(errorBody);
    }

    setupStreamingHeaders(res);

    const evaluationId = uuidv4();
    const completionId = `judge-${evaluationId}`;
    let leftover = '';
    let contentBuffer = '';
    let finished = false;
    let lastFinishReason = null;

    const finalize = () => {
      if (finished) return;
      finished = true;
      let parsed = null;
      try {
        parsed = contentBuffer ? JSON.parse(contentBuffer) : null;
      } catch {
        parsed = null;
      }

      const scoresObject =
        parsed && typeof parsed === 'object' && typeof parsed.scores === 'object'
          ? parsed.scores
          : null;

      const scoreAFromLegacy = Number.isFinite(Number(parsed?.score_a))
        ? Number(parsed.score_a)
        : null;
      const scoreBFromLegacy = Number.isFinite(Number(parsed?.score_b))
        ? Number(parsed.score_b)
        : null;

      const getScoreForLabel = (label, fallback) => {
        if (!scoresObject || typeof scoresObject !== 'object') {
          return fallback ?? null;
        }
        const raw = scoresObject[label];
        return Number.isFinite(Number(raw)) ? Number(raw) : fallback ?? null;
      };

      const winnerRaw = typeof parsed?.winner === 'string' ? parsed.winner : null;
      let winnerLabel = 'tie';
      if (winnerRaw === 'model_a') {
        winnerLabel = 'primary';
      } else if (winnerRaw === 'model_b') {
        winnerLabel = responseLabels[0]?.label || 'tie';
      } else if (
        winnerRaw &&
        (winnerRaw === 'tie' ||
          winnerRaw === 'primary' ||
          responseLabels.some((r) => r.label === winnerRaw))
      ) {
        winnerLabel = winnerRaw;
      }

      const scoreA = getScoreForLabel('primary', scoreAFromLegacy);
      const scoreB = responseLabels[0]
        ? getScoreForLabel(responseLabels[0].label, scoreBFromLegacy)
        : null;
      const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : contentBuffer;

      const evaluationModels = [
        {
          modelId: 'primary',
          conversationId,
          messageId,
          score: scoreA,
        },
        ...responseLabels.map((model) => ({
          modelId: model.label,
          conversationId: model.conversationId,
          messageId: model.messageId,
          score: getScoreForLabel(model.label, null),
        })),
      ];

      const evaluation = createEvaluation({
        userId,
        conversationId,
        modelAConversationId: conversationId,
        modelAMessageId: messageId,
        modelBConversationId: comparisonModels[0].conversationId,
        modelBMessageId: comparisonModels[0].messageId,
        judgeModelId,
        criteria: normalizedCriteria || null,
        scoreA,
        scoreB,
        winner: winnerLabel,
        reasoning,
        createdAt: new Date().toISOString(),
        models: evaluationModels,
      });

      if (lastFinishReason || lastFinishReason === null) {
        const finalChunk = createChatCompletionChunk(completionId, judgeModelId, {}, lastFinishReason || 'stop');
        writeAndFlush(res, `data: ${JSON.stringify(finalChunk)}\n\n`);
      }

      writeAndFlush(res, `data: ${JSON.stringify({ type: 'evaluation', evaluation })}\n\n`);
      writeAndFlush(res, 'data: [DONE]\n\n');
      res.end();
    };

    upstream.body.on('data', (chunk) => {
      leftover = parseSSEStream(
        chunk,
        leftover,
        (obj) => {
          const choice = obj?.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) {
            contentBuffer += delta.content;
            const chunkPayload = createChatCompletionChunk(completionId, judgeModelId, {
              content: delta.content,
            });
            writeAndFlush(res, `data: ${JSON.stringify(chunkPayload)}\n\n`);
          }
          if (choice?.finish_reason) {
            lastFinishReason = choice.finish_reason;
          }
        },
        () => {
          finalize();
        },
        (err) => {
          logger.warn('[judge] Failed to parse SSE chunk', err);
        }
      );
    });

    upstream.body.on('end', () => finalize());
    upstream.body.on('error', (err) => {
      logger.error('[judge] upstream stream error', err);
      if (!res.writableEnded) {
        res.end();
      }
    });
  } catch (error) {
    logger.error('[judge] error', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

chatRouter.delete('/v1/chat/judge/:id', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const success = deleteEvaluation({ id: req.params.id, userId });
    if (!success) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.status(204).end();
  } catch (error) {
    logger.error({
      msg: 'delete_evaluation_error',
      id: req.params.id,
      error: error.message,
    });
    return res.status(500).json({ error: 'internal_error' });
  }
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
