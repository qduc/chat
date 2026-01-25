/**
 * ToolSegment - Collapsible tool call display
 * Shows tool name, parameters, and results
 */

import React from 'react';
import { Clock, Search, Zap, ChevronDown } from 'lucide-react';
import type { ToolOutput } from './types';

interface ToolSegmentProps {
  messageId: string;
  modelId: string;
  segmentIndex: number;
  toolCall: any;
  outputs: ToolOutput[];
  isCollapsed: boolean;
  onToggle: () => void;
}

export function ToolSegment({ toolCall, outputs, isCollapsed, onToggle }: ToolSegmentProps) {
  const toolName = toolCall.function?.name;
  let parsedArgs = {};
  const argsRaw = toolCall.function?.arguments || '';
  let argsParseFailed = false;

  if (typeof argsRaw === 'string') {
    if (argsRaw.trim()) {
      try {
        parsedArgs = JSON.parse(argsRaw);
      } catch {
        argsParseFailed = true;
      }
    }
  } else {
    parsedArgs = argsRaw;
  }

  const getToolIcon = (name: string) => {
    const iconProps = {
      size: 14,
      strokeWidth: 1.5,
      className:
        'text-zinc-400 dark:text-zinc-500 group-hover/tool-btn:text-zinc-600 dark:group-hover/tool-btn:text-zinc-300 transition-colors duration-300',
    };
    switch (name) {
      case 'get_time':
        return <Clock {...iconProps} />;
      case 'web_search':
        return <Search {...iconProps} />;
      default:
        return <Zap {...iconProps} />;
    }
  };

  const getToolDisplayName = (name: string) => {
    switch (name) {
      case 'get_time':
        return 'Check Time';
      case 'web_search':
        return 'Search Web';
      default:
        return name;
    }
  };

  const getInputSummary = (args: any, raw: string, parseFailed: boolean) => {
    if (parseFailed && raw) {
      const cleaned = raw.trim().replace(/\s+/g, ' ');
      return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
    }
    if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
      return null;
    }
    try {
      if (typeof args === 'string') {
        const cleaned = args.trim().replace(/\s+/g, ' ');
        return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
      }
      const str = JSON.stringify(args);
      const cleaned = str.replace(/\s+/g, ' ');
      return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
    } catch {
      return String(args).slice(0, 80);
    }
  };

  const inputSummary = getInputSummary(parsedArgs, argsRaw, argsParseFailed);
  const hasDetails =
    outputs.length > 0 ||
    Object.keys(parsedArgs).length > 0 ||
    (argsParseFailed && argsRaw.trim().length > 0);
  const isCompleted = outputs.length > 0;

  return (
    <div className="my-3 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/30 overflow-hidden shadow-sm">
      <button
        onClick={() => {
          if (!hasDetails) return;
          onToggle();
        }}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors select-none ${
          !hasDetails ? 'cursor-default' : 'hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer'
        }`}
      >
        <div
          className={`text-zinc-400 dark:text-zinc-500 scale-90 ${!isCompleted ? 'animate-pulse' : ''}`}
        >
          {React.cloneElement(getToolIcon(toolName) as React.ReactElement<any>, {
            fill: isCompleted ? 'currentColor' : 'none',
            className: isCompleted
              ? 'text-zinc-500 dark:text-zinc-400'
              : 'text-zinc-400 dark:text-zinc-500',
          })}
        </div>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 font-mono">
          {getToolDisplayName(toolName)}
        </span>
        {isCollapsed && inputSummary && (
          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500 truncate max-w-[300px] opacity-80 font-mono">
            {inputSummary}
          </span>
        )}
        {hasDetails && (
          <div className="ml-auto flex items-center gap-2">
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${!isCollapsed ? 'rotate-180' : ''} text-zinc-400 dark:text-zinc-500`}
            />
          </div>
        )}
      </button>
      {!isCollapsed && hasDetails && (
        <div className="border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-black/20 px-4 py-3 text-[13px]">
          <div className="space-y-4">
            {(Object.keys(parsedArgs).length > 0 ||
              (argsParseFailed && argsRaw.trim().length > 0)) && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider pl-0.5 mb-1.5">
                  Parameters
                </div>
                <div className="font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                  {argsParseFailed ? argsRaw : JSON.stringify(parsedArgs, null, 2)}
                </div>
              </div>
            )}
            {outputs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider pl-0.5 mb-1.5">
                  Result
                </div>
                <div className="space-y-3">
                  {outputs.map((out: any, outIdx: number) => {
                    const raw = out.output ?? out;
                    let formatted = '';
                    if (typeof raw === 'string') {
                      formatted = raw;
                    } else {
                      try {
                        formatted = JSON.stringify(raw, null, 2);
                      } catch {
                        formatted = String(raw);
                      }
                    }
                    return (
                      <div
                        key={outIdx}
                        className="font-mono text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed"
                      >
                        {formatted}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
