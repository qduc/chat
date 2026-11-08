import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { config } from '../../src/env.js';
import { getDb, resetDbCache } from '../../src/db/index.js';
import { listJournalEntries } from '../../src/db/journal.js';
import { safeTestSetup } from '../../test_support/databaseSafety.js';
import { ensureTestUser, TEST_USER_ID } from '../helpers/systemPromptsTestUtils.js';
import { createTool } from '../../src/lib/tools/baseTool.js';
import { journalTool } from '../../src/lib/tools/journal.js';
import { tools as registeredTools } from '../../src/lib/tools/index.js';
import { createToolRegistry, toHarnessTool } from '../../src/lib/harness/tools.ts';
import type { ChatForgeTool, ChatForgeToolContext } from '../../src/lib/harness/tools.ts';
import type { ToolContext } from '../../src/lib/harness/contracts.ts';

function ctx(userId: string | null): ToolContext<ChatForgeToolContext> {
  return {
    app: { userId },
    signal: new AbortController().signal,
    progress: () => {},
    runNested: () => Promise.reject(new Error('no nested runs in ChatForge')),
  };
}

const echo = createTool({
  name: 'echo',
  description: 'Echo the input',
  validate: (args: { text?: unknown }) => {
    if (typeof args?.text !== 'string') throw new Error('echo.text must be a string');
    return { text: args.text.trim() };
  },
  handler: async (args: { text: string }, context: { userId: string | null }) => ({ said: args.text, by: context.userId }),
  openAI: {
    type: 'function',
    function: {
      name: 'echo',
      description: 'Echo it back',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
}) as unknown as ChatForgeTool;

describe('toHarnessTool', () => {
  const tool = toHarnessTool(echo);

  test('maps the OpenAI spec to a ToolSpec', () => {
    expect(tool.spec).toEqual({
      name: 'echo',
      description: 'Echo it back',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    });
  });

  test('parse is validate, and throws on invalid input', () => {
    expect(tool.parse({ text: '  hi ' })).toEqual({ text: 'hi' });
    expect(tool.parse('{"text":"raw"}')).toEqual({ text: 'raw' });
    expect(() => tool.parse({})).toThrow('echo.text must be a string');
  });

  test('approval is always none', async () => {
    expect(await tool.approval({ text: 'x' }, ctx('u1'))).toEqual({ kind: 'none' });
  });

  test('execute passes the user id from ctx.app and serializes objects', async () => {
    const result = await tool.execute({ text: 'hi' }, ctx('u1'));
    expect(result).toEqual({ output: '{"said":"hi","by":"u1"}', isError: false });
  });

  test('a throwing handler becomes an error result with the legacy message', async () => {
    const failing = toHarnessTool({
      ...echo,
      handler: () => {
        throw new Error('boom');
      },
    });
    const result = await failing.execute({ text: 'hi' }, ctx('u1'));
    expect(result).toEqual({
      output: "Error executing tool 'echo': boom. Please check the arguments and try again.",
      isError: true,
    });
  });
});

describe('createToolRegistry', () => {
  test('offers every registered tool by default', () => {
    const registry = createToolRegistry();
    expect(registry.available({ userId: null }).map((t) => t.spec.name).sort()).toEqual(
      Object.keys(registeredTools).sort(),
    );
  });

  test('limits a turn to the enabled tools', () => {
    const registry = createToolRegistry(['journal']);
    expect(registry.available({ userId: null }).map((t) => t.spec.name)).toEqual(['journal']);
    expect(registry.get('journal')).toBeDefined();
    expect(registry.get('web_search')).toBeUndefined();
  });
});

describe('journal through the harness contract', () => {
  beforeAll(() => {
    safeTestSetup();
    (config as { persistence: { enabled: boolean; dbUrl: string } }).persistence.enabled = true;
    (config as { persistence: { enabled: boolean; dbUrl: string } }).persistence.dbUrl = 'file::memory:';
    resetDbCache();
    getDb();
    ensureTestUser();
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM journal').run();
    ensureTestUser();
  });

  afterAll(() => {
    resetDbCache();
  });

  const journal = toHarnessTool(journalTool as unknown as ChatForgeTool);

  test('writes for the user in ctx.app, and reads back only theirs', async () => {
    const input = journal.parse({ mode: 'write', name: 'gpt-x', content: 'remember this' });
    expect(await journal.execute(input, ctx(TEST_USER_ID))).toEqual({ output: '{"success":true}', isError: false });

    expect(listJournalEntries(TEST_USER_ID, 1, 10)).toEqual([
      expect.objectContaining({ model_name: 'gpt-x', content: 'remember this' }),
    ]);

    const read = await journal.execute(journal.parse({ mode: 'read' }), ctx(TEST_USER_ID));
    expect(JSON.parse(read.output).entries).toHaveLength(1);
  });

  test('without a user in ctx.app it fails as a tool error', async () => {
    const result = await journal.execute(journal.parse({ mode: 'read' }), ctx(null));
    expect(result.isError).toBe(true);
    expect(result.output).toContain('requires an authenticated user context');
  });
});
