/**
 * ChatForge tools behind the harness `Tool` contract.
 *
 * The mapping from `createTool` is direct:
 *   spec.inputSchema = openAI.function.parameters
 *   parse            = validate
 *   execute          = handler
 *   approval         = none (ChatForge tools never ask)
 *
 * Per-user data reaches tools through the app context (`ctx.app`), never
 * through module state, so one registry instance can't leak a user id into
 * another user's turn.
 */
import { tools as registeredTools } from '../tools/index.js';
import type { Tool, ToolContext, ToolRegistry, ToolResult } from '@qduc/agent-core';

/** What ChatForge hands every tool, as `ToolContext.app`. */
export type ChatForgeToolContext = {
  readonly userId: string | null;
};

/** The shape `createTool` (tools/baseTool.js) returns. */
export type ChatForgeTool = {
  readonly name: string;
  readonly description: string;
  readonly validate: (args: unknown) => unknown;
  readonly handler: (args: unknown, context: { userId: string | null }) => unknown;
  readonly spec: {
    readonly type: 'function';
    readonly function: {
      readonly name?: string;
      readonly description?: string;
      readonly parameters?: Readonly<Record<string, unknown>>;
    };
  };
};

const EMPTY_OBJECT_SCHEMA = Object.freeze({ type: 'object', properties: {} });

/** Same text the model saw from the legacy loop, so behavior doesn't drift. */
function serializeOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  if (typeof output === 'object') return JSON.stringify(output);
  return String(output);
}

export function toHarnessTool(tool: ChatForgeTool): Tool<unknown, ChatForgeToolContext> {
  const fn = tool.spec.function;
  return {
    spec: {
      name: fn.name || tool.name,
      description: fn.description || tool.description || '',
      inputSchema: fn.parameters ?? EMPTY_OBJECT_SCHEMA,
    },
    // Tools that ran under the legacy parallel mode keep running concurrently;
    // the engine's `maxParallelToolCalls` bounds them.
    parallelSafe: true,
    parse(raw) {
      // The engine passes parsed JSON; accept a raw string defensively.
      const args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
      return tool.validate(args);
    },
    approval() {
      return { kind: 'none' };
    },
    async execute(input, ctx: ToolContext<ChatForgeToolContext>): Promise<ToolResult> {
      try {
        const output = await tool.handler(input, { userId: ctx.app.userId });
        return { output: serializeOutput(output), isError: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: `Error executing tool '${tool.name}': ${message}. Please check the arguments and try again.`,
          isError: true,
        };
      }
    },
  };
}

/**
 * The tools one turn may call. Pass the names the request enabled; omit them
 * to offer every registered tool.
 */
export function createToolRegistry(
  enabledNames?: readonly string[],
  source: Readonly<Record<string, ChatForgeTool>> = registeredTools as Record<string, ChatForgeTool>,
): ToolRegistry<ChatForgeToolContext> {
  const allowed = enabledNames ? new Set(enabledNames) : null;
  const wrapped = new Map<string, Tool<unknown, ChatForgeToolContext>>();
  for (const [name, tool] of Object.entries(source)) {
    if (allowed && !allowed.has(name)) continue;
    wrapped.set(name, toHarnessTool(tool));
  }
  const list = [...wrapped.values()];
  return {
    get: (name) => wrapped.get(name),
    available: () => list,
  };
}
