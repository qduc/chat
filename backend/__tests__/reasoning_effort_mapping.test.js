import { ChatCompletionsAdapter } from '../src/lib/adapters/chatCompletionsAdapter.js';
import { ResponsesAPIAdapter } from '../src/lib/adapters/responsesApiAdapter.js';
import { GeminiAdapter } from '../src/lib/adapters/geminiAdapter.js';
import { ConversationTitleService } from '../src/lib/persistence/ConversationTitleService.js';

const responses = new ResponsesAPIAdapter({ getDefaultModel: () => 'gpt-default' });
const nested = new ChatCompletionsAdapter({ reasoningFormat: 'nested' });
const flat = new ChatCompletionsAdapter({ reasoningFormat: 'flat' });
const deepseek = new ChatCompletionsAdapter({ reasoningFormat: 'deepseek' });
const llama = new ChatCompletionsAdapter({ reasoningFormat: 'llama-cpp' });
const gemini = new GeminiAdapter({ config: {}, settings: {} });

const APP_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];

function openAIExpected(model, effort) {
  const id = model.split('/').pop().toLowerCase();
  if (id.startsWith('gpt-6-astra') || id.startsWith('gpt-6.1-sol')) {
    if (effort === 'none' || effort === 'minimal') return 'low';
    if (effort === 'max') return 'xhigh';
    return effort;
  }
  if (id.startsWith('gpt-6-luna')) {
    if (effort === 'minimal') return 'none';
    if (effort === 'max') return 'xhigh';
    return effort;
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

function isGemini4Id(id) {
  return /^gemini-4(?:[.-]|$)/.test(id);
}

function isHydrogenId(id) {
  return /^gemini-4(?:\.\d+)?-hydrogen(?:-|$)/.test(id);
}

function geminiExpected(model, effort) {
  const id = model.split('/').pop().toLowerCase();
  const base = { includeThoughts: true };

  if (isGemini4Id(id)) {
    if (effort === 'none' || effort === 'minimal') return { ...base, thinkingLevel: 'low' };
    const levels = isHydrogenId(id) ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high'];
    const requested = effort === 'max' ? 'xhigh' : effort;
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
    const gemmaEffort = effort === 'max' || effort === 'xhigh' ? 'high' : effort;
    return { ...base, thinkingLevel: gemmaEffort };
  }

  if (effort === 'none' || effort === 'minimal') return { ...base, thinkingBudget: 0 };
  return { ...base, thinkingBudget: -1 };
}

describe('Gemini reasoning effort mapping', () => {
  const levelModels = [
    'gemini-4-carbon',
    'gemini-4-argon',
    'gemini-4-hydrogen',
    'gemini-4.1-pro',
    'gemini-4.1-hydrogen',
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

describe('legacy minimal is off when the model has an off setting', () => {
  test('gpt-6-luna sends none', async () => {
    for (const model of ['gpt-6-luna', 'openai/gpt-6-luna']) {
      const responsesRequest = await responsesEffort(model, 'minimal');
      const chatRequest = await chatEffort(nested, model, 'minimal');
      expect(responsesRequest.reasoning.effort).toBe('none');
      expect(chatRequest.reasoning.effort).toBe('none');
    }
  });

  test('gpt-6-astra and gpt-6.1-sol send low', async () => {
    for (const model of ['gpt-6-astra', 'openai/gpt-6-astra', 'gpt-6.1-sol', 'openai/gpt-6.1-sol']) {
      const responsesRequest = await responsesEffort(model, 'minimal');
      const chatRequest = await chatEffort(nested, model, 'minimal');
      expect(responsesRequest.reasoning.effort).toBe('low');
      expect(chatRequest.reasoning.effort).toBe('low');
    }
  });

  test('Gemini 4 sends thinkingLevel low and never thinkingBudget', async () => {
    for (const model of ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen', 'gemini-4.1-pro', 'gemini-4.1-hydrogen']) {
      for (const effort of ['none', 'minimal']) {
        const request = await gemini.translateRequest({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          reasoning_effort: effort,
        });
        expect(request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'low' });
        expect(request.generationConfig.thinkingConfig).not.toHaveProperty('thinkingBudget');
      }
    }
  });

  test('Gemini 2.5 sends thinkingBudget 0', async () => {
    const request = await gemini.translateRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'minimal',
    });
    expect(request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 0 });
  });

  test('Gemini 3.x sends its lowest supported level', async () => {
    const cases = [
      ['gemini-3.8-flash', 'low'],
      ['gemini-3.7-flash', 'low'],
      ['gemini-3.5-flash', 'minimal'],
      ['gemini-3-flash-preview', 'minimal'],
      ['gemini-3-pro-preview', 'low'],
      ['gemini-3.1-pro-preview', 'low'],
    ];
    for (const [model, level] of cases) {
      const request = await gemini.translateRequest({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'minimal',
      });
      expect(request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: level });
    }
  });

  test('DeepSeek disables thinking', async () => {
    const request = await chatEffort(deepseek, 'deepseek-reasoner', 'minimal');
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.reasoning).toBeUndefined();
    expect(request.reasoning_effort).toBeUndefined();
  });

  test('llama.cpp disables thinking', async () => {
    const request = await chatEffort(llama, 'llama-local', 'minimal');
    expect(request.chat_template_kwargs).toEqual({
      reasoning_effort: 'low',
      enable_thinking: false,
      thinking_mode: 'disabled',
      reasoning_budget: 0,
    });
    expect(request.reasoning).toBeUndefined();
  });

  test('max becomes xhigh and then the nearest accepted level', async () => {
    const deepseekMax = await chatEffort(deepseek, 'deepseek-reasoner', 'max');
    expect(deepseekMax.thinking).toEqual({ type: 'enabled' });
    expect(deepseekMax.reasoning_effort).toBe('max');

    const llamaMax = await chatEffort(llama, 'llama-local', 'max');
    expect(llamaMax.chat_template_kwargs).toEqual({
      reasoning_effort: 'high',
      enable_thinking: true,
      thinking_mode: 'high',
      reasoning_budget: 16384,
    });

    const gemma = await gemini.translateRequest({
      model: 'gemma-4-26b',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'max',
    });
    expect(gemma.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'high' });

    for (const model of ['gpt-5.1', 'gpt-5.1-mini', 'gpt-5.1-20251101', 'openai/gpt-5.1', 'openai/gpt-5.1-mini']) {
      expect((await responsesEffort(model, 'none')).reasoning.effort).toBe('none');
      expect((await responsesEffort(model, 'minimal')).reasoning.effort).toBe('none');
      expect((await responsesEffort(model, 'low')).reasoning.effort).toBe('low');
      expect((await responsesEffort(model, 'medium')).reasoning.effort).toBe('medium');
      expect((await responsesEffort(model, 'high')).reasoning.effort).toBe('high');
      expect((await responsesEffort(model, 'xhigh')).reasoning.effort).toBe('high');
      expect((await responsesEffort(model, 'max')).reasoning.effort).toBe('high');
      expect((await chatEffort(nested, model, 'xhigh')).reasoning.effort).toBe('high');
      expect((await chatEffort(nested, model, 'max')).reasoning.effort).toBe('high');
      expect((await chatEffort(flat, model, 'xhigh')).reasoning_effort).toBe('high');
      expect((await chatEffort(flat, model, 'max')).reasoning_effort).toBe('high');
    }
  });

  test('gemini-3-pro medium ties round down to low', async () => {
    const request = await gemini.translateRequest({
      model: 'gemini-3-pro-preview',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'medium',
    });
    expect(request.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
  });

  test('native Gemini 4 titles ask for none and translate to thinkingLevel low', async () => {
    for (const model of ['gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4.1-pro']) {
      const raw = ConversationTitleService.buildTitleRequestBody(model, 'How do I bake sourdough bread?');
      expect(raw.reasoning_effort).toBe('none');
      expect(raw.temperature).toBe(0.2);
      expect(raw.max_tokens).toBe(1024);
      const translated = await gemini.translateRequest({ ...raw, stream: false });
      expect(translated.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'low' });
      expect(translated.generationConfig.thinkingConfig).not.toHaveProperty('thinkingBudget');
      expect(translated.generationConfig.maxOutputTokens).toBe(1024);
      expect(translated.generationConfig.temperature).toBe(0.2);
    }
  });

  test('OpenRouter google/gemini titles send low, not none', async () => {
    for (const model of ['google/gemini-3.8-flash', 'google/gemini-4-hydrogen', 'openrouter::google/gemini-4.1-pro']) {
      const raw = ConversationTitleService.buildTitleRequestBody(model, 'How do I bake sourdough bread?');
      expect(raw.model).toBe(model);
      expect(raw.reasoning_effort).toBe('low');
      expect(raw.temperature).toBe(0.2);
      expect(raw.max_tokens).toBe(1024);
      const translated = await nested.translateRequest(raw);
      expect(translated.reasoning).toEqual({ effort: 'low' });
      expect(translated.max_tokens).toBe(1024);
      expect(translated.temperature).toBe(0.2);
    }
  });

  test('other OpenAI-compatible models keep minimal', async () => {
    for (const model of ['gpt-4o', 'gpt-6.1-terra', 'openai/gpt-6-sol']) {
      const responsesRequest = await responsesEffort(model, 'minimal');
      const chatRequest = await chatEffort(nested, model, 'minimal');
      expect(responsesRequest.reasoning).toEqual({ effort: 'minimal', summary: 'auto' });
      expect(chatRequest.reasoning).toEqual({ effort: 'minimal' });
    }
  });
});
