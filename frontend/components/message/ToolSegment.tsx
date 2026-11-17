/**
 * ToolSegment - Collapsible tool call display
 * Shows tool name, parameters, and results
 */

import React from 'react';
import { Clock, Search, Zap, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ToolOutput } from './types';

interface ToolSegmentProps {
  messageId: string;
  modelId: string;
  segmentIndex: number;
  toolCall: any;
  outputs: ToolOutput[];
  isCollapsed: boolean;
  onToggle: () => void;
  nested?: boolean;
}

function ToolIcon({ name, ...props }: { name: string } & React.ComponentProps<typeof Zap>) {
  switch (name) {
    case 'get_time':
      return <Clock {...props} />;
    case 'web_search':
      return <Search {...props} />;
    default:
      return <Zap {...props} />;
  }
}

function getToolDisplayName(name: string) {
  switch (name) {
    case 'get_time':
      return 'Check Time';
    case 'web_search':
      return 'Search Web';
    default:
      return name;
  }
}

function truncate(text: string) {
  return text.length > 80 ? text.slice(0, 77) + '...' : text;
}

function getInputSummary(args: any, raw: string, parseFailed: boolean) {
  if (parseFailed && raw) {
    return truncate(raw.trim().replace(/\s+/g, ' '));
  }
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
    return null;
  }
  try {
    if (typeof args === 'string') {
      return truncate(args.trim().replace(/\s+/g, ' '));
    }
    return truncate(JSON.stringify(args).replace(/\s+/g, ' '));
  } catch {
    return String(args).slice(0, 80);
  }
}

function formatOutput(out: any): string {
  const raw = out.output ?? out;
  if (typeof raw === 'string') {
    // Tool results arrive as JSON text; indent objects the same way live and after reload.
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

const sectionLabelClasses = 'text-xs text-fg-subtle';
const codeTextClasses = 'font-mono whitespace-pre-wrap leading-relaxed text-fg-muted';

export function ToolSegment({
  toolCall,
  outputs,
  isCollapsed,
  onToggle,
  nested = false,
}: ToolSegmentProps) {
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

  const inputSummary = getInputSummary(parsedArgs, argsRaw, argsParseFailed);
  const hasArgs =
    Object.keys(parsedArgs).length > 0 || (argsParseFailed && argsRaw.trim().length > 0);
  const hasDetails = outputs.length > 0 || hasArgs;
  const isCompleted = outputs.length > 0;

  return (
    <div
      className={cn(!nested && 'my-3 overflow-hidden rounded-card border border-line bg-surface')}
    >
      <button
        type="button"
        onClick={() => {
          if (!hasDetails) return;
          onToggle();
        }}
        aria-expanded={hasDetails ? !isCollapsed : undefined}
        className={cn(
          'flex w-full items-center gap-3 px-4 text-left transition-colors select-none focus-ring-inset',
          nested ? 'py-2' : 'py-3',
          hasDetails ? 'cursor-pointer hover:bg-muted' : 'cursor-default'
        )}
      >
        <ToolIcon
          name={toolName}
          aria-hidden="true"
          fill={isCompleted ? 'currentColor' : 'none'}
          className={cn(
            'size-4 shrink-0',
            isCompleted ? 'text-fg-muted' : 'animate-pulse text-fg-subtle'
          )}
        />
        <span className="font-mono text-xs font-medium text-fg">
          {getToolDisplayName(toolName)}
        </span>
        {isCollapsed && inputSummary && (
          <span className="max-w-75 truncate font-mono text-xs text-fg-subtle">{inputSummary}</span>
        )}
        {hasDetails && (
          <ChevronDown
            aria-hidden="true"
            className={cn('ml-auto size-4 shrink-0 text-fg-subtle', !isCollapsed && 'rotate-180')}
          />
        )}
      </button>
      {!isCollapsed && hasDetails && (
        <div className="space-y-4 border-t border-line bg-canvas-subtle px-4 py-3 text-sm">
          {hasArgs && (
            <div className="space-y-1">
              <div className={sectionLabelClasses}>Parameters</div>
              <div className={codeTextClasses}>
                {argsParseFailed ? argsRaw : JSON.stringify(parsedArgs, null, 2)}
              </div>
            </div>
          )}
          {outputs.length > 0 && (
            <div className="space-y-1">
              <div className={sectionLabelClasses}>Result</div>
              <div className="space-y-3">
                {outputs.map((out: any, outIdx: number) => (
                  <div key={outIdx} className={codeTextClasses}>
                    {formatOutput(out)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
