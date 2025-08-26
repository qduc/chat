import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Gauge, Cpu, Clock, AlignLeft, Wrench, Zap, FlaskConical } from 'lucide-react';
import type { PendingState } from '../hooks/useChatStream';
import IconSelect from './ui/IconSelect';
import Toggle from './ui/Toggle';
import QualitySlider from './ui/QualitySlider';
import { useChatContext } from '../contexts/ChatContext';

interface MessageInputProps {
  input: string;
  pending: PendingState;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  model: string;
  useTools: boolean;
  shouldStream: boolean;
  researchMode: boolean;
  onModelChange: (model: string) => void;
  onUseToolsChange: (useTools: boolean) => void;
  onShouldStreamChange: (val: boolean) => void;
  onResearchModeChange: (val: boolean) => void;
}

export function MessageInput({
  input,
  pending,
  onInputChange,
  onSend,
  onStop,
  model,
  useTools,
  shouldStream,
  researchMode,
  onModelChange,
  onUseToolsChange,
  onShouldStreamChange,
  onResearchModeChange
}: MessageInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    qualityLevel,
    setQualityLevel,
  } = useChatContext();

  // Auto-grow textarea up to ~200px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(200, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);


  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (pending.streaming) onStop();
      else onSend();
    }
  };

  return (
    <form
      className=""
      onSubmit={e => { e.preventDefault(); if (pending.streaming) onStop(); else onSend(); }}
    >
      <div className="px-2">
        <div className="relative rounded-2xl bg-white/95 dark:bg-neutral-900/95 border border-slate-200 dark:border-neutral-700 shadow-xl backdrop-blur-lg transition-all duration-200">
          <textarea
            ref={inputRef}
            className="w-full resize-none bg-transparent border-0 outline-none p-4 text-sm placeholder-slate-500 dark:placeholder-slate-400 text-slate-800 dark:text-slate-200"
            placeholder="Type your message..."
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-4 text-xs scrollbar-hide">
              <div className="flex items-center">
                <IconSelect
                  ariaLabel="Model"
                  icon={<Cpu className="w-4 h-4" />}
                  value={model}
                  onChange={onModelChange}
                  className="text-xs py-1 px-2"
                  options={[
                    { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
                    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                    { value: 'gpt-4o', label: 'GPT-4o' }
                  ]}
                />
              </div>

              {model?.startsWith('gpt-5') && (
                <div className="flex items-center">
                  <QualitySlider
                    value={qualityLevel}
                    onChange={setQualityLevel}
                    icon={<Gauge className="w-4 h-4" />}
                    ariaLabel="Response Quality"
                    className="flex-shrink-0"
                  />
                </div>
              )}

              <div className="flex items-center">
                <Toggle
                  ariaLabel="Tools"
                  icon={<Wrench className="w-4 h-4" />}
                  checked={useTools}
                  onChange={onUseToolsChange}
                  className="whitespace-nowrap"
                />
              </div>

              <div className="flex items-center">
                <Toggle
                  ariaLabel="Stream"
                  icon={<Zap className="w-4 h-4" />}
                  checked={shouldStream}
                  onChange={onShouldStreamChange}
                  className="whitespace-nowrap"
                />
              </div>

              <div className="flex items-center">
                <Toggle
                  ariaLabel="Research"
                  icon={<FlaskConical className="w-4 h-4" />}
                  checked={researchMode}
                  onChange={onResearchModeChange}
                  disabled={!useTools}
                  className="whitespace-nowrap"
                />
              </div>
            </div>
            <button
                type="button"
                onClick={() => {
                  if (pending.streaming) {
                    onStop();
                  } else {
                    onSend();
                  }
                }}
                disabled={!input.trim() && !pending.streaming}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg disabled:hover:shadow-md transform hover:scale-[1.02] disabled:hover:scale-100"
              >
                {pending.streaming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Stop
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
          </div>
        </div>
      </div>
    </form>
  );
}
