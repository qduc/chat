/**
 * Map the app's reasoning effort vocabulary onto what each model accepts.
 *
 * The app's set is none, low, medium, high, xhigh. `minimal` and `max` still
 * arrive from older clients; they map to the nearest accepted level here so
 * this does not depend on upstream normalization landing first.
 *
 * Models that are not listed keep the effort they were given.
 */

const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * A title has to leave room for thinking tokens, which count against the
 * output cap. Live calls with max_tokens 20 came back empty: gpt-6-luna
 * stopped incomplete, and gemini-3.8-flash stopped at MAX_TOKENS after
 * spending the budget on thoughts (plain gemini-3.8-flash used ~211 thought
 * tokens; gemini-4-carbon at low used ~99).
 */
export const TITLE_REASONING_MAX_TOKENS = 1024;

/**
 * Supported `reasoning.effort` values, lowest to highest.
 *
 * - gpt-6-astra: low, medium, high, xhigh, max. `none` is rejected.
 *   https://developers.openai.com/api/docs/models/gpt-6-astra
 * - gpt-6.1-sol: low, medium (default), high, xhigh, max. No `none` or `minimal`.
 *   https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * - gpt-6-luna: none, low, medium (default), high, xhigh, max.
 *   https://developers.openai.com/api/docs/models/gpt-6-luna
 * - Sampling params are rejected when effort is not `none`:
 *   https://developers.openai.com/api/docs/guides/latest-model
 * - Family summary (Astra and GPT-6.1 Sol have no `none`; Luna does; `xhigh` is in the effort guide):
 *   https://developers.openai.com/api/docs/guides/reasoning
 */
const OPENAI_PROFILES = [
  {
    pattern: /^gpt-6-astra(?:-\d{8})?$/,
    levels: ['low', 'medium', 'high', 'xhigh'],
    rejectsSamplingUnlessNone: true,
  },
  {
    pattern: /^gpt-6\.1-sol(?:-\d{8})?$/,
    levels: ['low', 'medium', 'high', 'xhigh'],
    rejectsSamplingUnlessNone: true,
  },
  {
    pattern: /^gpt-6-luna(?:-\d{8})?$/,
    levels: ['none', 'low', 'medium', 'high', 'xhigh'],
    rejectsSamplingUnlessNone: true,
  },
];

export function canonicalModelId(model) {
  if (typeof model !== 'string') return '';
  let id = model.trim().toLowerCase();
  const scoped = id.lastIndexOf('::');
  if (scoped !== -1) id = id.slice(scoped + 2).trim();
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1).trim();
  const colon = id.indexOf(':');
  if (colon !== -1) id = id.slice(0, colon).trim();
  return id;
}

function openAIProfile(model) {
  const id = canonicalModelId(model);
  return OPENAI_PROFILES.find((profile) => profile.pattern.test(id)) ?? null;
}

/**
 * Nearest level in `supported`. An exact match wins. Legacy `minimal` starts
 * the search at `low` and legacy `max` starts at `xhigh` (the same aliases
 * upstream normalization uses) so a tie cannot land on `none`. Any remaining
 * tie picks the lower level.
 */
export function nearestSupportedEffort(effort, supported) {
  const requested = String(effort).toLowerCase();
  if (supported.includes(requested)) return requested;

  const start = requested === 'minimal' ? 'low' : requested === 'max' ? 'xhigh' : requested;
  if (supported.includes(start)) return start;

  const startIndex = EFFORT_LADDER.indexOf(start);
  if (startIndex === -1) return requested;

  let best = null;
  let bestDist = Infinity;
  let bestIndex = Infinity;
  for (const level of supported) {
    const index = EFFORT_LADDER.indexOf(level);
    if (index === -1) continue;
    const dist = Math.abs(index - startIndex);
    if (dist < bestDist || (dist === bestDist && index < bestIndex)) {
      best = level;
      bestDist = dist;
      bestIndex = index;
    }
  }
  return best ?? requested;
}

/**
 * Effort to send on the OpenAI Responses and Chat Completions APIs.
 * Unlisted models (including gpt-6.1-terra and gpt-6-sol) are returned unchanged.
 */
export function mapOpenAIReasoningEffort(model, effort) {
  if (typeof effort !== 'string' || effort.length === 0) return effort;
  const profile = openAIProfile(model);
  if (!profile) return effort;
  return nearestSupportedEffort(effort, profile.levels);
}

function isGemini4(id) {
  return id === 'gemini-4' || id.startsWith('gemini-4-');
}

function isGemini4Hydrogen(id) {
  return id === 'gemini-4-hydrogen' || id.startsWith('gemini-4-hydrogen-');
}

function isGemini3(id) {
  return id === 'gemini-3' || id.startsWith('gemini-3-') || id.startsWith('gemini-3.');
}

/**
 * Thinking levels a Gemini 3 model accepts.
 *
 * gemini-3.8-flash and gemini-3.7-flash reject `minimal` (live API also
 * rejects `none`). Lowest level is `low`.
 * https://firebase.google.com/docs/ai-logic/thinking
 *
 * Older 3.x levels:
 * https://ai.google.dev/gemini-api/docs/thinking
 * - gemini-3-pro: low, high
 * - gemini-3.1-pro: low, medium, high
 * - gemini-3-flash / gemini-3.5-flash / flash-lite: minimal, low, medium, high
 * - gemini-3.1-flash-lite-image: minimal, high
 * None of these accept `xhigh`. `none` is not a thinking level.
 */
function gemini3Levels(id) {
  if (id.includes('flash-lite-image')) return ['minimal', 'high'];
  if (id.includes('flash-lite')) return ['minimal', 'low', 'medium', 'high'];
  if (/^gemini-3\.[87]-flash(?:-|$)/.test(id)) return ['low', 'medium', 'high'];
  if (/^gemini-3-pro(?:-|$)/.test(id)) return ['low', 'high'];
  if (/^gemini-3\.1-pro(?:-|$)/.test(id)) return ['low', 'medium', 'high'];
  if (id.includes('flash')) return ['minimal', 'low', 'medium', 'high'];
  return ['low', 'medium', 'high'];
}

/**
 * Fields to merge into Gemini `thinkingConfig` for Gemini 3 and 4.
 * Returns null for Gemini 2.x, Gemma, and anything else so those stay on
 * the budget / Gemma path.
 *
 * Gemini 4 is level-based: Carbon and Argon accept low, medium, high.
 * Hydrogen also accepts xhigh. `none` stays `thinkingBudget: 0`, which the
 * live Gemini 4 Carbon call accepted (0 thought tokens).
 * https://firebase.google.com/docs/ai-logic/thinking
 */
export function resolveGeminiThinking(model, effort) {
  if (typeof effort !== 'string' || effort.length === 0 || effort === 'unset') return null;
  const id = canonicalModelId(model);
  const requested = effort.toLowerCase();

  if (isGemini4(id)) {
    if (requested === 'none') return { thinkingBudget: 0 };
    const levels = isGemini4Hydrogen(id)
      ? ['low', 'medium', 'high', 'xhigh']
      : ['low', 'medium', 'high'];
    return { thinkingLevel: nearestSupportedEffort(requested, levels) };
  }

  if (isGemini3(id)) {
    return { thinkingLevel: nearestSupportedEffort(requested, gemini3Levels(id)) };
  }

  return null;
}

/**
 * Title-generation request adjustments for models whose default thinking
 * consumes a 20-token cap. Other models return null and keep temperature 0.2
 * and max_tokens 20.
 *
 * The request asks for effort `none` (lowest intent). Adapters map that to
 * the lowest effort the model accepts. Temperature is omitted only when the
 * effort that will actually be sent is not `none` on a model that rejects
 * sampling params in that case (GPT-6 Astra and GPT-6.1 Sol). Gemini accepts
 * temperature 0.2, and GPT-6 Luna accepts it at effort `none`.
 * https://developers.openai.com/api/docs/guides/latest-model
 */
export function titleGenerationOverrides(model) {
  const id = canonicalModelId(model);
  const profile = openAIProfile(id);
  const geminiReasoning = isGemini3(id) || isGemini4(id);
  if (!profile && !geminiReasoning) return null;

  const mapped = profile ? nearestSupportedEffort('none', profile.levels) : 'none';
  const stripTemperature = Boolean(profile?.rejectsSamplingUnlessNone && mapped !== 'none');
  return {
    reasoningEffort: 'none',
    maxTokens: TITLE_REASONING_MAX_TOKENS,
    includeTemperature: !stripTemperature,
  };
}
