import getTimeTool from './getTime.js';
import webSearchTool from './webSearch.js';

const registeredTools = [getTimeTool, webSearchTool];

const toolMap = new Map();
for (const tool of registeredTools) {
  if (toolMap.has(tool.name)) {
    throw new Error(`Duplicate tool name detected: ${tool.name}`);
  }
  toolMap.set(tool.name, tool);
}

export const tools = Object.fromEntries(toolMap.entries());

export function generateOpenAIToolSpecs() {
  return registeredTools.map((tool) => tool.spec);
}

export function generateToolSpecs() {
  return generateOpenAIToolSpecs();
}

export function getAvailableTools() {
  return registeredTools.map((tool) => tool.name);
}
