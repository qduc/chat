import { Router } from 'express';
import { ZodError } from 'zod';
import * as promptService from '../lib/promptService.js';
import {
  validateCreatePrompt,
  validateUpdatePrompt,
  validateSelectPrompt,
  validateClearSelection,
  validatePromptId
} from '../lib/validation/systemPromptsSchemas.js';

export const systemPromptsRouter = Router();

// Base path: /v1/system-prompts

// GET /v1/system-prompts - List built-in and custom prompts
systemPromptsRouter.get('/v1/system-prompts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    const result = await promptService.listAllPrompts(userId);

    // Include error flag for frontend graceful fallback, but also log it
    if (result.error) {
      console.warn('[systemPrompts] Warning:', result.error);
    }

    res.json({
      built_ins: result.built_ins,
      custom: result.custom,
      error: result.error || null
    });
  } catch (error) {
    console.error('[systemPrompts] Error listing prompts:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to list prompts' });
  }
});

// POST /v1/system-prompts - Create custom prompt
systemPromptsRouter.post('/v1/system-prompts', async (req, res) => {
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
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request data',
        details: error.errors
      });
    }

    console.error('[systemPrompts] Error creating prompt:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to create prompt' });
  }
});

// PATCH /v1/system-prompts/:id - Update custom prompt
systemPromptsRouter.patch('/v1/system-prompts/:id', async (req, res) => {
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
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request data',
        details: error.errors
      });
    }

    if (error.message === 'Built-in prompts are read-only') {
      return res.status(400).json({
        error: 'read_only',
        message: 'Built-in prompts cannot be modified'
      });
    }

    console.error('[systemPrompts] Error updating prompt:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to update prompt' });
  }
});

// DELETE /v1/system-prompts/:id - Delete custom prompt
systemPromptsRouter.delete('/v1/system-prompts/:id', async (req, res) => {
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
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid prompt ID',
        details: error.errors
      });
    }

    if (error.message === 'Built-in prompts cannot be deleted') {
      return res.status(400).json({
        error: 'read_only',
        message: 'Built-in prompts cannot be deleted'
      });
    }

    console.error('[systemPrompts] Error deleting prompt:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to delete prompt' });
  }
});

// POST /v1/system-prompts/:id/duplicate - Duplicate prompt
systemPromptsRouter.post('/v1/system-prompts/:id/duplicate', async (req, res) => {
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
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid prompt ID',
        details: error.errors
      });
    }

    console.error('[systemPrompts] Error duplicating prompt:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to duplicate prompt' });
  }
});

// POST /v1/system-prompts/:id/select - Select prompt for conversation
systemPromptsRouter.post('/v1/system-prompts/:id/select', async (req, res) => {
  try {
    const userId = req.user?.id;
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
      userId,
      inline_override
    );

    res.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request data',
        details: error.errors
      });
    }

    if (error.message === 'Prompt not found') {
      return res.status(404).json({ error: 'not_found', message: 'Prompt not found' });
    }

    console.error('[systemPrompts] Error selecting prompt:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to select prompt' });
  }
});

// POST /v1/system-prompts/none/select - Clear active prompt selection
systemPromptsRouter.post('/v1/system-prompts/none/select', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    }

    // Validate request body
    const { conversation_id } = validateClearSelection(req.body);

    // Clear prompt selection
    const result = await promptService.clearPromptFromConversation(conversation_id);

    res.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Invalid request data',
        details: error.errors
      });
    }

    console.error('[systemPrompts] Error clearing prompt selection:', error);
    res.status(500).json({ error: 'internal_server_error', message: 'Failed to clear prompt selection' });
  }
});

export default systemPromptsRouter;