/**
 * Quality level to reasoning effort and verbosity mapping
 */

import type { QualityLevel } from '../../../components/ui/QualitySlider';

export interface QualityMapping {
  reasoningEffort: string;
  verbosity: string;
}

export const qualityLevelMap: Record<QualityLevel, QualityMapping> = {
  quick: { reasoningEffort: 'minimal', verbosity: 'low' },
  balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
  thorough: { reasoningEffort: 'high', verbosity: 'high' },
};

/**
 * Get derived settings for a quality level
 */
export function getQualityMapping(level: QualityLevel): QualityMapping {
  return qualityLevelMap[level];
}
