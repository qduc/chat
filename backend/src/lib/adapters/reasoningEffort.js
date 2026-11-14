/**
 * Per-adapter mapping from an effort value onto what that model accepts.
 *
 * This is not the incoming normalizer. `minimal` and `max` may still arrive.
 * `minimal` turns thinking off when the model has an off setting (`none`, or
 * Gemini 2.x `thinkingBudget: 0`). Gemini 4 has no off switch: `none` and
 * `minimal` use thinking level `low` and never send `thinkingBudget`.
 * Otherwise `minimal` uses the lowest accepted level.
 * `max` starts at `xhigh`, then the nearest accepted level.
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
 * Nearest value in `supported`, which is ordered lowest to highest.
 *
 * `minimal` is the legacy off request: `none` when that off setting is
 * accepted, otherwise the lowest accepted level (the first entry). A model
 * whose accepted levels include the level named `minimal` therefore keeps it.
 * `max` starts at `xhigh`, then the nearest accepted level. Ties round down:
 * when two accepted levels are the same distance away, the lower one wins
 * (less thinking). `gemini-3-pro` `medium` is equidistant from `low` and
 * `high`, so it sends `low`.
 */
export function nearestSupportedEffort(effort, supported) {
  const requested = String(effort).toLowerCase();
  if (requested === 'minimal') {
    if (supported.includes('none')) return 'none';
    return supported[0] ?? requested;
  }

  const start = requested === 'max' ? 'xhigh' : requested;
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
 * gpt-5.1 accepts only `none`, `low`, `medium`, and `high`, including dated
 * and vendor-prefixed ids (`gpt-5.1-20251101`, `openai/gpt-5.1-mini`).
 * `xhigh` and `max` are the nearest step above `high`, so both send `high`.
 * https://developers.openai.com/api/docs/models/gpt-5.1
 */
function isGpt51(model) {
  return /^gpt-5\.1(?:-|$)/.test(canonicalModelId(model));
}

const GPT51_LEVELS = ['none', 'low', 'medium', 'high'];

export function mapOpenAIReasoningEffort(model, effort) {
  if (typeof effort !== 'string' || effort.length === 0) return effort;
  const profile = openAIProfile(model);
  if (profile) return nearestSupportedEffort(effort, profile.levels);
  if (isGpt51(model)) return nearestSupportedEffort(effort, GPT51_LEVELS);
  return effort;
}

function isGemini4(id) {
  return /^gemini-4(?:[.-]|$)/.test(id);
}

function isGemini4Hydrogen(id) {
  return /^gemini-4(?:\.\d+)?-hydrogen(?:-|$)/.test(id);
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
 * Hydrogen also accepts xhigh, including `gemini-4.1-hydrogen`. `none` and
 * `minimal` use the lowest level. Gemini 4 never sends `thinkingBudget`.
 * https://firebase.google.com/docs/ai-logic/thinking
 */
const GEMINI_4_OFF_LEVEL = 'low';

export function resolveGeminiThinking(model, effort) {
  if (typeof effort !== 'string' || effort.length === 0 || effort === 'unset') return null;
  const id = canonicalModelId(model);
  const requested = effort.toLowerCase();

  if (isGemini4(id)) {
    if (requested === 'none' || requested === 'minimal') return { thinkingLevel: GEMINI_4_OFF_LEVEL };
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
 * Native Gemini still asks for effort `none`; the Gemini adapter lowers that
 * to the model's minimum (`low` on Gemini 4, the documented floor on Gemini 3).
 * A routed id such as `google/gemini-3.8-flash` is Chat Completions, which has
 * no thinking-level translator. Those titles send `low` directly. `none` is
 * rejected by Gemini 3.8. Temperature is omitted only when the effort that
 * will actually be sent is not `none` on GPT-6 Astra or GPT-6.1 Sol.
 * https://developers.openai.com/api/docs/guides/latest-model
 */
function isRoutedModel(model) {
  if (typeof model !== 'string') return false;
  let id = model.trim().toLowerCase();
  const scoped = id.lastIndexOf('::');
  if (scoped !== -1) id = id.slice(scoped + 2).trim();
  return id.includes('/');
}

export function titleGenerationOverrides(model) {
  const id = canonicalModelId(model);
  const profile = openAIProfile(id);
  const geminiReasoning = isGemini3(id) || isGemini4(id);
  if (!profile && !geminiReasoning) return null;

  const mapped = profile ? nearestSupportedEffort('none', profile.levels) : 'none';
  const stripTemperature = Boolean(profile?.rejectsSamplingUnlessNone && mapped !== 'none');
  // OpenRouter slugs (`google/gemini-*`) stay on Chat Completions. Send the
  // same lowest level native Gemini uses for these models: `low`.
  const reasoningEffort = geminiReasoning && isRoutedModel(model) ? 'low' : 'none';
  return {
    reasoningEffort,
    maxTokens: TITLE_REASONING_MAX_TOKENS,
    includeTemperature: !stripTemperature,
  };
}
