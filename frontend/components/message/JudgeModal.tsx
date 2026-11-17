/**
 * JudgeModal - Modal for configuring judge evaluation
 * Allows selecting judge model, models to compare, and evaluation criteria
 */

import React, { useState, useEffect, useId } from 'react';
import { Modal } from '../ui/Modal';
import ModelSelector from '../ui/ModelSelector';
import QualitySlider from '../ui/QualitySlider';
import { Gauge } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/cn';
import type { ReasoningEffortLevel } from '../../lib/types';

const sectionLabelClasses = 'text-sm font-medium text-fg';

/** Selectable option tile; the selected state uses the accent as its indicator. */
const optionClasses = (selected: boolean) =>
  cn(
    'flex flex-col gap-1 rounded-control border px-3 py-2 text-left transition-colors focus-ring',
    selected ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:bg-muted'
  );

interface JudgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: {
    judgeModelId: string;
    selectedModelIds: string[];
    criteria: string | null;
    reasoningEffort?: ReasoningEffortLevel | null;
  }) => void;
  availableModels: string[];
  primaryModelLabel: string | null;
  modelGroups: Array<{
    id: string;
    label: string;
    options: Array<{ value: string; label: string }>;
  }>;
  modelOptions: Array<{ value: string; label: string }>;
  initialJudgeModelId?: string;
}

const CRITERIA_OPTIONS = [
  { id: 'general', label: 'General check', helper: 'Overall correctness and helpfulness.' },
  { id: 'fact', label: 'Fact check', helper: 'Accuracy and factual correctness.' },
  { id: 'creative', label: 'Creative check', helper: 'Originality and expressiveness.' },
  { id: 'code', label: 'Code quality', helper: 'Correctness, clarity, and best practices.' },
  { id: 'custom', label: 'Custom', helper: 'Specify your own criteria.' },
];

export function JudgeModal({
  isOpen,
  onClose,
  onConfirm,
  availableModels,
  primaryModelLabel,
  modelGroups,
  modelOptions,
  initialJudgeModelId,
}: JudgeModalProps) {
  const [judgeModelId, setJudgeModelId] = useState<string>(
    initialJudgeModelId || modelOptions[0]?.value || ''
  );
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<'general' | 'fact' | 'creative' | 'code' | 'custom'>(
    'general'
  );
  const [customCriteria, setCustomCriteria] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortLevel>('unset');
  const judgeLabelId = useId();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && availableModels.length >= 2) {
      setSelectedModelIds(availableModels);
      setJudgeModelId(initialJudgeModelId || modelOptions[0]?.value || '');
      setCriteria('general');
      setCustomCriteria('');
      setReasoningEffort('unset');
    }
    // Use stable init - only run once when modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const formatModelLabel = (modelId: string | null | undefined) => {
    if (!modelId) return 'Model';
    return modelId.includes('::') ? modelId.split('::')[1] : modelId;
  };

  const handleConfirm = () => {
    if (!judgeModelId || selectedModelIds.length < 2) return;

    const selectedCriteria = CRITERIA_OPTIONS.find((item) => item.id === criteria);
    const criteriaText =
      criteria === 'custom' ? customCriteria.trim() : selectedCriteria?.label || 'General check';

    onConfirm({
      judgeModelId,
      selectedModelIds,
      criteria: criteriaText || null,
      reasoningEffort: reasoningEffort !== 'unset' ? reasoningEffort : null,
    });
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Judge responses"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!judgeModelId || selectedModelIds.length < 2}
          >
            Start judging
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div role="group" aria-labelledby={judgeLabelId}>
          <div id={judgeLabelId} className={sectionLabelClasses}>
            Judge model
          </div>
          <div className="mt-2 flex items-center gap-3">
            <ModelSelector
              value={judgeModelId || modelOptions[0]?.value || ''}
              onChange={setJudgeModelId}
              groups={modelGroups}
              fallbackOptions={modelOptions}
              ariaLabel="Select judge model"
              favoritesStorageKey="chatforge-favorite-judge-models"
              recentStorageKey="chatforge-recent-judge-models"
            />
            <QualitySlider
              value={reasoningEffort}
              onChange={setReasoningEffort}
              ariaLabel="Judge reasoning effort"
              icon={<Gauge className="size-4" />}
            />
          </div>
        </div>

        <fieldset>
          <legend className={sectionLabelClasses}>Models to compare</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {availableModels.map((modelId) => {
              const isSelected = selectedModelIds.includes(modelId);
              const displayLabel =
                modelId === 'primary'
                  ? formatModelLabel(primaryModelLabel)
                  : formatModelLabel(modelId);
              return (
                <button
                  key={modelId}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelectedModelIds((prev) => {
                      if (prev.includes(modelId)) {
                        // Require at least 2 models
                        if (prev.length <= 2) return prev;
                        return prev.filter((id) => id !== modelId);
                      }
                      return [...prev, modelId];
                    })
                  }
                  className={optionClasses(isSelected)}
                >
                  <div className="text-sm font-medium text-fg">{displayLabel}</div>
                  <div className="text-xs text-fg-subtle">
                    {isSelected ? 'Selected' : 'Click to include'}
                  </div>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className={sectionLabelClasses}>Criteria</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CRITERIA_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={criteria === option.id}
                onClick={() => setCriteria(option.id as typeof criteria)}
                className={optionClasses(criteria === option.id)}
              >
                <div className="text-sm font-medium text-fg">{option.label}</div>
                <div className="text-xs text-fg-subtle">{option.helper}</div>
              </button>
            ))}
          </div>
          {criteria === 'custom' && (
            <Input
              type="text"
              value={customCriteria}
              onChange={(e) => setCustomCriteria(e.target.value)}
              placeholder="Enter custom criteria..."
              aria-label="Custom criteria"
              className="mt-2"
            />
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
