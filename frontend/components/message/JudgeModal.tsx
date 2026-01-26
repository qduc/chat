/**
 * JudgeModal - Modal for configuring judge evaluation
 * Allows selecting judge model, models to compare, and evaluation criteria
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import ModelSelector from '../ui/ModelSelector';

interface JudgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: {
    judgeModelId: string;
    selectedModelIds: string[];
    criteria: string | null;
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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && availableModels.length >= 2) {
      setSelectedModelIds(availableModels);
      setJudgeModelId(initialJudgeModelId || primaryModelLabel || modelOptions[0]?.value || '');
      setCriteria('general');
      setCustomCriteria('');
    }
  }, [isOpen, availableModels, initialJudgeModelId, primaryModelLabel, modelOptions]);

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
    });
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Judge responses" maxWidthClassName="max-w-2xl">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Judge model
          </label>
          <div className="mt-2">
            <ModelSelector
              value={judgeModelId || modelOptions[0]?.value || ''}
              onChange={setJudgeModelId}
              groups={modelGroups}
              fallbackOptions={modelOptions}
              ariaLabel="Select judge model"
              favoritesStorageKey="chatforge-favorite-judge-models"
              recentStorageKey="chatforge-recent-judge-models"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Models to compare
          </label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                  className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                    isSelected
                      ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="font-medium">{displayLabel}</div>
                  <div className="text-[10px] opacity-70">
                    {isSelected ? 'Selected' : 'Click to include'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Criteria</label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CRITERIA_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCriteria(option.id as typeof criteria)}
                className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                  criteria === option.id
                    ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-[10px] opacity-70">{option.helper}</div>
              </button>
            ))}
          </div>
          {criteria === 'custom' && (
            <input
              type="text"
              value={customCriteria}
              onChange={(e) => setCustomCriteria(e.target.value)}
              placeholder="Enter custom criteria..."
              className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!judgeModelId || selectedModelIds.length < 2}
            className="px-3 py-2 text-xs rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start judging
          </button>
        </div>
      </div>
    </Modal>
  );
}
