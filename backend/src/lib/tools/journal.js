import { createTool } from './baseTool.js';
import { insertJournalEntry, listJournalEntries } from '../../db/journal.js';

const TOOL_NAME = 'journal';

function validate(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('journal requires an arguments object');
  }

  const { mode } = args;
  if (!mode || !['write', 'read'].includes(mode)) {
    throw new Error('journal.mode must be either "write" or "read"');
  }

  if (mode === 'write') {
    if (typeof args.name !== 'string' || args.name.trim().length === 0) {
      throw new Error('journal write requires a "name" string (model name)');
    }
    if (typeof args.content !== 'string' || args.content.trim().length === 0) {
      throw new Error('journal write requires a non-empty "content" string');
    }
    return { mode: 'write', name: args.name.trim(), content: args.content };
  }

  // read
  const page = args.page !== undefined ? Number(args.page) : 1;
  if (!Number.isInteger(page) || page < 1) throw new Error('journal.read page must be an integer >= 1');
  return { mode: 'read', page };
}

async function handler(validatedArgs, context = {}) {
  // context may contain userId
  const userId = context?.userId;
  if (!userId) {
    throw new Error('journal tool requires an authenticated user context');
  }

  if (validatedArgs.mode === 'write') {
    const { name, content } = validatedArgs;
    try {
      insertJournalEntry({ userId, modelName: name, content });
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  // read mode: default pageSize 10
  const pageSize = 10;
  const page = validatedArgs.page || 1;
  const entries = listJournalEntries(userId, page, pageSize);
  return { entries, page, pageSize };
}

export const journalTool = createTool({
  name: TOOL_NAME,
  description: 'Persistent journal for LLM to record private notes. Modes: write (save entry) and read (read recent entries). Requires authenticated user.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Persistent journal for the LLM to record or retrieve private notes. write: { name, content } | read: { page }',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['write', 'read'],
            description: 'Operation mode: "write" to append an entry, "read" to list recent entries',
          },
          name: {
            type: 'string',
            description: "Model name (required for write)",
          },
          content: {
            type: 'string',
            description: 'Content to save (required for write)',
          },
          page: {
            type: 'integer',
            description: 'Page number for read (1-based). Defaults to 1',
            minimum: 1,
          },
        },
        required: ['mode'],
      },
    },
  },
});

export default journalTool;
