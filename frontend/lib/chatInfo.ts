/**
 * Read-only description of the current chat's settings for the details panel.
 */
import type { CustomRequestParamPreset, ModelGroup } from './types';

export interface ChatInfo {
  /** Model id without the provider prefix. */
  modelId: string;
  providerId: string | null;
  providerName: string | null;
  reasoningLabel: string;
  /** Enabled tool names; empty when tools are off. */
  tools: string[];
  paramsLabel: string;
  streaming: boolean;
  /** ISO time the conversation was created, when known. */
  startedAt: string | null;
}

const REASONING_LABELS: Record<string, string> = {
  unset: 'Default',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
};

export function reasoningEffortLabel(effort: string | null | undefined): string {
  if (!effort) return 'Default';
  return REASONING_LABELS[effort] ?? effort;
}

export function splitQualifiedModel(
  model: string,
  fallbackProviderId: string | null
): { modelId: string; providerId: string | null } {
  if (model.includes('::')) {
    const [providerId, ...rest] = model.split('::');
    return { modelId: rest.join('::'), providerId: providerId || fallbackProviderId };
  }
  return { modelId: model, providerId: fallbackProviderId };
}

export interface BuildChatInfoInput {
  model: string;
  providerId: string | null;
  modelGroups: ModelGroup[];
  reasoningEffort: string | null | undefined;
  useTools: boolean;
  enabledTools: string[];
  customRequestParams: CustomRequestParamPreset[];
  customRequestParamsId: string[] | null | undefined;
  shouldStream: boolean;
  startedAt: string | null | undefined;
}

export function buildChatInfo(input: BuildChatInfoInput): ChatInfo {
  const { modelId, providerId } = splitQualifiedModel(input.model || '', input.providerId);
  const providerName = providerId
    ? (input.modelGroups.find((group) => group.id === providerId)?.label ?? null)
    : null;

  const presetIds = input.customRequestParamsId ?? [];
  const presetLabels = presetIds
    .map((id) => input.customRequestParams.find((preset) => preset.id === id)?.label ?? id)
    .filter(Boolean);

  return {
    modelId,
    providerId,
    providerName,
    reasoningLabel: reasoningEffortLabel(input.reasoningEffort),
    tools: input.useTools ? input.enabledTools.filter(Boolean) : [],
    paramsLabel: presetLabels.length > 0 ? presetLabels.join(', ') : 'Default',
    streaming: input.shouldStream,
    startedAt: input.startedAt ?? null,
  };
}

/** Collapsed "This chat" summary, e.g. "claude-sonnet-5-5 · 2 tools". */
export function formatChatInfoSummary(info: ChatInfo): string {
  const parts: string[] = [];
  if (info.modelId) parts.push(info.modelId);
  if (info.tools.length > 0) {
    parts.push(`${info.tools.length} ${info.tools.length === 1 ? 'tool' : 'tools'}`);
  }
  return parts.join(' · ');
}
