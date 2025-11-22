import webSearchTool from './webSearch.js';
import webSearchExaTool from './webSearchExa.js';
import webSearchSearxngTool from './webSearchSearxng.js';
import webFetchTool from './webFetch.js';
import journalTool from './journal.js';

const registeredTools = [webSearchTool, webSearchExaTool, webSearchSearxngTool, webFetchTool, journalTool];

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
