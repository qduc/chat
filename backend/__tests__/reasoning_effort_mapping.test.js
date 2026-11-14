import { ChatCompletionsAdapter } from '../src/lib/adapters/chatCompletionsAdapter.js';
import { ResponsesAPIAdapter } from '../src/lib/adapters/responsesApiAdapter.js';
import { GeminiAdapter } from '../src/lib/adapters/geminiAdapter.js';

const responses = new ResponsesAPIAdapter({ getDefaultModel: () => 'gpt-default' });
const nested = new ChatCompletionsAdapter({ reasoningFormat: 'nested' });
const flat = new ChatCompletionsAdapter({ reasoningFormat: 'flat' });
const deepseek = new ChatCompletionsAdapter({ reasoningFormat: 'deepseek' });
const llama = new ChatCompletionsAdapter({ reasoningFormat: 'llama-cpp' });
const gemini = new GeminiAdapter({ config: {}, settings: {} });

const APP_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];

function openAIExpected(model, effort) {
  const id = model.split('/').pop().toLowerCase();
  const legacy = effort === 'minimal' ? 'low' : effort === 'max' ? 'xhigh' : effort;
  if (id.startsWith('gpt-6-astra') || id.startsWith('gpt-6.1-sol')) {
    if (legacy === 'none') return 'low';
    return legacy;
  }
  if (id.startsWith('gpt-6-luna')) {
    return legacy;
  }
  return effort;
}

async function responsesEffort(model, effort) {
  const request = await responses.translateRequest({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: effort,
    max_tokens: 32,
    temperature: 0.2,
  });
  return request;
}

async function chatEffort(adapter, model, effort) {
  return adapter.translateRequest({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    reasoning_effort: effort,
    max_tokens: 32,
    temperature: 0.2,
  });
}

describe('OpenAI reasoning effort mapping', () => {
  const affected = [
    'gpt-6-astra',
    'openai/gpt-6-astra',
    'gpt-6-astra-20260415',
    'gpt-6.1-sol',
    'openai/gpt-6.1-sol',
    'gpt-6-luna',
    'openai/gpt-6-luna',
    'openrouter::openai/gpt-6-luna',
  ];

  test.each(affected.flatMap((model) => APP_EFFORTS.map((effort) => [model, effort])))(
    'responses %s effort %s is accepted',
    async (model, effort) => {
      const request = await responsesEffort(model, effort);
      expect(request.reasoning).toEqual({ effort: openAIExpected(model, effort), summary: 'auto' });
      expect(request.reasoning_effort).toBeUndefined();
      expect(request.max_output_tokens).toBe(32);
      expect(request.temperature).toBe(0.2);
      expect(request.model).toBe(model);
    }
  );

  test.each(affected.flatMap((model) => APP_EFFORTS.map((effort) => [model, effort])))(
    'chat completions nested %s effort %s is accepted',
    async (model, effort) => {
      const request = await chatEffort(nested, model, effort);
      expect(request.reasoning).toEqual({ effort: openAIExpected(model, effort) });
      expect(request.reasoning_effort).toBeUndefined();
      expect(request.max_tokens).toBe(32);
      expect(request.temperature).toBe(0.2);
    }
  );

  test.each(['none', 'minimal', 'low', 'xhigh', 'max'])(
    'chat completions flat maps gpt-6-astra %s',
    async (effort) => {
      const request = await chatEffort(flat, 'openai/gpt-6-astra', effort);
      expect(request.reasoning_effort).toBe(openAIExpected('gpt-6-astra', effort));
      expect(request.reasoning).toBeUndefined();
    }
  );

  test.each(['none', 'minimal', 'max', 'xhigh'])(
    'legacy and boundary effort %s on the affected models',
    async (effort) => {
      for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']) {
        const responsesRequest = await responsesEffort(model, effort);
        const chatRequest = await chatEffort(nested, model, effort);
        const expected = openAIExpected(model, effort);
        expect(responsesRequest.reasoning.effort).toBe(expected);
        expect(chatRequest.reasoning.effort).toBe(expected);
      }
    }
  );

  test.each([
    'gpt-4o',
    'gpt-4.1-mini',
    'gpt-5.4',
    'gpt-6.1-terra',
    'openai/gpt-6-sol',
    'claude-opus-4-5',
  ])('%s request shape is unchanged for every app effort', async (model) => {
    for (const effort of [...APP_EFFORTS, 'minimal', 'max']) {
      const responsesRequest = await responsesEffort(model, effort);
      const chatRequest = await chatEffort(nested, model, effort);
      expect(responsesRequest.reasoning).toEqual({ effort, summary: 'auto' });
      expect(chatRequest.reasoning).toEqual({ effort });
      expect(responsesRequest.temperature).toBe(0.2);
      expect(chatRequest.temperature).toBe(0.2);
    }
  });

  test('deepseek and llama.cpp maps are not rewritten for gpt-6-astra', async () => {
    const deepseekNone = await chatEffort(deepseek, 'gpt-6-astra', 'none');
    expect(deepseekNone.thinking).toEqual({ type: 'disabled' });
    expect(deepseekNone.reasoning).toBeUndefined();

    const llamaNone = await chatEffort(llama, 'gpt-6-astra', 'none');
    expect(llamaNone.chat_template_kwargs).toEqual({
      reasoning_effort: 'low',
      enable_thinking: false,
      thinking_mode: 'disabled',
      reasoning_budget: 0,
    });
    expect(llamaNone.reasoning).toBeUndefined();
  });
});

function geminiExpected(model, effort) {
  const id = model.split('/').pop().toLowerCase();
  const base = { includeThoughts: true };

  if (id.startsWith('gemini-4-')) {
    if (effort === 'none') return { ...base, thinkingBudget: 0 };
    const hydrogen = id.startsWith('gemini-4-hydrogen');
    const levels = hydrogen ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high'];
    const requested = effort === 'minimal' ? 'low' : effort === 'max' ? 'xhigh' : effort;
    const thinkingLevel = levels.includes(requested) ? requested : 'high';
    return { ...base, thinkingLevel };
  }

  if (id.startsWith('gemini-3.8-flash') || id.startsWith('gemini-3.7-flash')) {
    const requested = effort === 'none' || effort === 'minimal' ? 'low' : effort === 'xhigh' || effort === 'max' ? 'high' : effort;
    return { ...base, thinkingLevel: requested };
  }

  if (id.startsWith('gemini-3.5-flash') || id === 'gemini-3-flash-preview') {
    if (effort === 'none') return { ...base, thinkingLevel: 'minimal' };
    if (effort === 'xhigh' || effort === 'max') return { ...base, thinkingLevel: 'high' };
    return { ...base, thinkingLevel: effort };
  }

  if (id.startsWith('gemini-3-pro')) {
    if (effort === 'none' || effort === 'minimal' || effort === 'medium') return { ...base, thinkingLevel: 'low' };
    if (effort === 'xhigh' || effort === 'max') return { ...base, thinkingLevel: 'high' };
    return { ...base, thinkingLevel: effort };
  }

  if (id.startsWith('gemini-3.1-pro')) {
    if (effort === 'none' || effort === 'minimal') return { ...base, thinkingLevel: 'low' };
    if (effort === 'xhigh' || effort === 'max') return { ...base, thinkingLevel: 'high' };
    return { ...base, thinkingLevel: effort };
  }

  if (id.startsWith('gemma-4')) {
    return { ...base, thinkingLevel: effort === 'xhigh' ? 'high' : effort };
  }

  if (effort === 'none' || effort === 'minimal') return { ...base, thinkingBudget: 0 };
  return { ...base, thinkingBudget: -1 };
}

describe('Gemini reasoning effort mapping', () => {
  const levelModels = [
    'gemini-4-carbon',
    'gemini-4-argon',
    'gemini-4-hydrogen',
    'models/gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-3.1-pro-preview',
  ];

  test.each(levelModels.flatMap((model) => [...APP_EFFORTS, 'minimal', 'max'].map((effort) => [model, effort])))(
    '%s effort %s sends an accepted thinking config',
    async (model, effort) => {
      const request = await gemini.translateRequest({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: effort,
        max_tokens: 64,
        temperature: 0.2,
      });
      expect(request.generationConfig.thinkingConfig).toEqual(geminiExpected(model, effort));
      expect(request.generationConfig.temperature).toBe(0.2);
      expect(request.generationConfig.maxOutputTokens).toBe(64);
    }
  );

  test.each(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemma-4-26b'])(
    '%s keeps its previous thinking shape',
    async (model) => {
      for (const effort of [...APP_EFFORTS, 'minimal', 'max']) {
        const request = await gemini.translateRequest({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          reasoning_effort: effort,
          temperature: 0.4,
        });
        expect(request.generationConfig.thinkingConfig).toEqual(geminiExpected(model, effort));
        expect(request.generationConfig.temperature).toBe(0.4);
      }
    }
  );

  test('omitted effort still only sets includeThoughts', async () => {
    for (const model of ['gemini-4-carbon', 'gemini-3.8-flash', 'gemini-2.5-flash']) {
      const request = await gemini.translateRequest({
        model,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true });
    }
  });
});
