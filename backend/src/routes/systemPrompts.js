import { Router } from 'express';
import { ZodError } from 'zod';
import * as promptService from '../lib/promptService.js';
import { PromptServiceError } from '../lib/promptService.js';
import {
  validateCreatePrompt,
  validateUpdatePrompt,
  validateSelectPrompt,
  validateClearSelection,
  validatePromptId
} from '../lib/validation/systemPromptsSchemas.js';
import { logger } from '../logger.js';
import { authenticateToken } from '../middleware/auth.js';

export const systemPromptsRouter = Router();

// Base path: /v1/system-prompts

// GET /v1/system-prompts - List built-in and custom prompts
systemPromptsRouter.get('/v1/system-prompts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    const result = await promptService.listAllPrompts(userId);

    // Include error flag for frontend graceful fallback, but also log it
    if (result.error) {
      // SECURITY: Log metadata only; never include prompt bodies or request payloads.
      logger.warn({
        msg: 'system_prompts:list_partial',
        warning: result.error
      });
    }

    res.json({
      built_ins: result.built_ins,
      custom: result.custom,
      error: result.error || null
    });
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:list_error',
      defaultMessage: 'Failed to list prompts'
    });
  }
});

// POST /v1/system-prompts - Create custom prompt
systemPromptsRouter.post('/v1/system-prompts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate request body
    const promptData = validateCreatePrompt(req.body);

    // Create prompt
    const newPrompt = promptService.createCustomPrompt(promptData, userId);

    res.status(201).json(newPrompt);
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:create_error',
      defaultMessage: 'Failed to create prompt',
      validationMessage: 'Invalid request data'
    });
  }
});

// PATCH /v1/system-prompts/:id - Update custom prompt
systemPromptsRouter.patch('/v1/system-prompts/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate prompt ID
    const promptId = validatePromptId(req.params.id);

    // Validate request body
    const updates = validateUpdatePrompt(req.body);

    // Update prompt
    const updatedPrompt = promptService.updateCustomPrompt(promptId, updates, userId);

    if (!updatedPrompt) {
      return res.status(404).json({ error: 'not_found', message: 'Prompt not found' });
    }

    res.json(updatedPrompt);
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:update_error',
      defaultMessage: 'Failed to update prompt',
      validationMessage: 'Invalid request data'
    });
  }
});

// DELETE /v1/system-prompts/:id - Delete custom prompt
systemPromptsRouter.delete('/v1/system-prompts/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate prompt ID
    const promptId = validatePromptId(req.params.id);

    // Delete prompt
    const deleted = promptService.deleteCustomPrompt(promptId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'not_found', message: 'Prompt not found' });
    }

    res.status(204).send();
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:delete_error',
      defaultMessage: 'Failed to delete prompt',
      validationMessage: 'Invalid prompt ID'
    });
  }
});

// POST /v1/system-prompts/:id/duplicate - Duplicate prompt
systemPromptsRouter.post('/v1/system-prompts/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate prompt ID
    const sourceId = validatePromptId(req.params.id);

    // Duplicate prompt
    const newPrompt = await promptService.duplicatePrompt(sourceId, userId);

    if (!newPrompt) {
      return res.status(404).json({ error: 'not_found', message: 'Source prompt not found' });
    }

    res.status(201).json(newPrompt);
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:duplicate_error',
      defaultMessage: 'Failed to duplicate prompt',
      validationMessage: 'Invalid prompt ID'
    });
  }
});

// POST /v1/system-prompts/none/select - Clear active prompt selection
systemPromptsRouter.post('/v1/system-prompts/none/select', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const sessionId = req.sessionId || null;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate request body
    const { conversation_id } = validateClearSelection(req.body);

    // Clear prompt selection
    const result = await promptService.clearPromptFromConversation(conversation_id, {
      userId,
      sessionId
    });

    res.json(result);
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:clear_error',
      defaultMessage: 'Failed to clear prompt selection',
      validationMessage: 'Invalid request data'
    });
  }
});

// POST /v1/system-prompts/:id/select - Select prompt for conversation
systemPromptsRouter.post('/v1/system-prompts/:id/select', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const sessionId = req.sessionId || null;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate prompt ID
    const promptId = validatePromptId(req.params.id);

    // Validate request body
    const { conversation_id, inline_override } = validateSelectPrompt(req.body);

    // Select prompt for conversation
    const result = await promptService.selectPromptForConversation(
      promptId,
      conversation_id,
      {
        userId,
        sessionId,
        inlineOverride: typeof inline_override === 'undefined' ? undefined : inline_override
      }
    );

    res.json(result);
  } catch (error) {
    return handlePromptError(res, error, {
      context: 'system_prompts:select_error',
      defaultMessage: 'Failed to select prompt',
      validationMessage: 'Invalid request data'
    });
  }
});

function handlePromptError(res, error, { context, defaultMessage, validationMessage = 'Invalid request data' }) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'validation_error',
      message: validationMessage,
      details: error.errors
    });
  }

  if (error instanceof PromptServiceError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message
    });
  }

  logger.error({
    msg: context,
    error: {
      name: error?.name || 'Error',
      message: error?.message || defaultMessage
    }
  });

  return res.status(500).json({ error: 'internal_server_error', message: defaultMessage });
}

export default systemPromptsRouter;