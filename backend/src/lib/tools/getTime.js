import { createTool } from './baseTool.js';

const TOOL_NAME = 'get_time';

function validate(args) {
  if (args && Object.keys(args).length > 0) {
    throw new Error('get_time takes no arguments');
  }
  return {};
}

async function handler() {
  const now = new Date();
  const iso = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const human = now.toLocaleString(undefined, {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  return { iso, human, timezone: tz };
}

export const getTimeTool = createTool({
  name: TOOL_NAME,
  description: 'Get the current time in ISO format with timezone information',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Get the current time in ISO format with timezone information',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
});

export default getTimeTool;
