/**
 * Helper utilities for processing stream events
 */

/**
 * Upserts a tool call into an existing array, handling incremental updates
 */
export function upsertToolCall(existing: any[] | undefined, incoming: any): any[] {
  const out = Array.isArray(existing) ? [...existing] : [];
  const idx: number | undefined = typeof incoming.index === 'number' ? incoming.index : undefined;
  const id: string | undefined = incoming.id;

  const resolveTextOffset = (prevOffset: any, nextOffset: any) => {
    const asNumber = (value: any) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    const prev = asNumber(prevOffset);
    const next = asNumber(nextOffset);
    if (prev !== undefined) return prev;
    if (next !== undefined) return next;
    return undefined;
  };

  const mergeArgs = (prevFn: any = {}, nextFn: any = {}) => {
    const prevArgs = typeof prevFn.arguments === 'string' ? prevFn.arguments : '';
    const nextArgs = typeof nextFn.arguments === 'string' ? nextFn.arguments : '';
    const mergedArgs = prevArgs && nextArgs && nextArgs.startsWith(prevArgs)
      ? nextArgs
      : (prevArgs + nextArgs);
    return {
      ...prevFn,
      ...nextFn,
      arguments: mergedArgs
    };
  };

  // Match by index if provided
  if (typeof idx === 'number') {
    while (out.length <= idx) out.push(undefined);
    const prev = out[idx] || {};
    out[idx] = {
      ...prev,
      ...incoming,
      textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
      function: mergeArgs(prev.function, incoming.function)
    };
    return out;
  }

  // Match by ID if provided
  if (id) {
    const found = out.findIndex(tc => tc && tc.id === id);
    if (found >= 0) {
      const prev = out[found];
      out[found] = {
        ...prev,
        ...incoming,
        textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
        function: mergeArgs(prev.function, incoming.function)
      };
      return out;
    }
  }

  // Match by function name if available
  if (incoming?.function?.name) {
    const found = out.findIndex(tc => tc?.function?.name === incoming.function.name && !tc?.id);
    if (found >= 0) {
      const prev = out[found];
      out[found] = {
        ...prev,
        ...incoming,
        textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
        function: mergeArgs(prev.function, incoming.function)
      };
      return out;
    }
  }

  // No match found, append new tool call
  out.push({ ...incoming });
  return out;
}

/**
 * Updates a message with streamed token content
 */
export function applyStreamToken(
  messages: any[],
  messageId: string,
  token: string,
  fullContent?: string
): any[] {
  let updated = false;
  const next = messages.map(m => {
    if (m.id === messageId) {
      updated = true;
      // Use fullContent if provided, otherwise append token
      const newContent = fullContent !== undefined
        ? fullContent
        : (m.content ?? '') + token;
      // Only create new object if content actually changed
      return newContent !== m.content ? { ...m, content: newContent } : m;
    }
    return m;
  });

  if (!updated) {
    // Fallback: update the last assistant message if present
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant') {
        const newContent = fullContent !== undefined
          ? fullContent
          : (next[i].content ?? '') + token;
        if (newContent !== next[i].content) {
          next[i] = { ...next[i], content: newContent };
        }
        break;
      }
    }
  }

  return next;
}

/**
 * Updates a message with a tool call
 */
export function applyStreamToolCall(
  messages: any[],
  messageId: string,
  toolCall: any
): any[] {
  let updated = false;
  const next = messages.map(m => {
    if (m.id === messageId) {
      updated = true;
      const tool_calls = upsertToolCall(m.tool_calls, toolCall);
      // Only create new object if tool_calls changed
      return tool_calls !== m.tool_calls ? { ...m, tool_calls } : m;
    }
    return m;
  });

  // Fallback in case message id not matched yet
  if (!updated) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant') {
        const m: any = next[i];
        const tool_calls = upsertToolCall(m.tool_calls, toolCall);
        if (tool_calls !== m.tool_calls) {
          next[i] = { ...m, tool_calls };
        }
        break;
      }
    }
  }

  return next;
}

/**
 * Updates a message with a tool output
 */
export function applyStreamToolOutput(
  messages: any[],
  messageId: string,
  toolOutput: any
): any[] {
  let updated = false;
  const next = messages.map(m => {
    if (m.id === messageId) {
      updated = true;
      const tool_outputs = [...(m.tool_outputs || []), toolOutput];
      // Check if this exact tool output already exists
      const alreadyExists = m.tool_outputs?.some((to: any) =>
        JSON.stringify(to) === JSON.stringify(toolOutput)
      );
      return alreadyExists ? m : { ...m, tool_outputs };
    }
    return m;
  });

  if (!updated) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant') {
        const existing = (next[i] as any).tool_outputs || [];
        const alreadyExists = existing.some((to: any) =>
          JSON.stringify(to) === JSON.stringify(toolOutput)
        );
        if (!alreadyExists) {
          const to = [...existing, toolOutput];
          next[i] = { ...(next[i] as any), tool_outputs: to };
        }
        break;
      }
    }
  }

  return next;
}

/**
 * Updates a message with usage metadata
 */
export function applyStreamUsage(
  messages: any[],
  messageId: string,
  usage: any
): any[] {
  let updated = false;
  const next = messages.map(m => {
    if (m.id === messageId) {
      updated = true;
      const newUsage = { ...m.usage, ...usage };
      // Only create a new object if usage actually changed
      const usageChanged = JSON.stringify(m.usage) !== JSON.stringify(newUsage);
      return usageChanged ? { ...m, usage: newUsage } : m;
    }
    return m;
  });

  // Fallback: update last assistant message if ID not matched
  if (!updated) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant') {
        const newUsage = { ...next[i].usage, ...usage };
        const usageChanged = JSON.stringify(next[i].usage) !== JSON.stringify(newUsage);
        if (usageChanged) {
          next[i] = { ...next[i], usage: newUsage };
        }
        break;
      }
    }
  }

  return next;
}
