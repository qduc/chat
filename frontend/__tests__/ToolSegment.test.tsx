/**
 * Tool results render the same whether they arrive as an object or as JSON text.
 * @jest-environment jsdom
 */

import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolSegment } from '../components/message/ToolSegment';

jest.mock('lucide-react', () => ({
  Clock: () => <span />,
  Search: () => <span />,
  Zap: () => <span />,
  ChevronDown: () => <span />,
}));

const toolCall = { id: 'call_1', function: { name: 'journal', arguments: '{"mode":"read"}' } };

function resultText(output: unknown) {
  const { container } = render(
    <ToolSegment
      messageId="m1"
      modelId="primary"
      segmentIndex={0}
      toolCall={toolCall}
      outputs={[{ tool_call_id: 'call_1', name: 'journal', output } as any]}
      isCollapsed={false}
      onToggle={jest.fn()}
    />
  );
  const blocks = container.querySelectorAll('.font-mono.whitespace-pre-wrap');
  return blocks[blocks.length - 1]?.textContent;
}

describe('ToolSegment result', () => {
  const value = { entries: [], page: 1 };
  const indented = JSON.stringify(value, null, 2);

  it('indents an object result', () => {
    expect(resultText(value)).toBe(indented);
  });

  it('indents a JSON text result the same way', () => {
    expect(resultText(JSON.stringify(value))).toBe(indented);
  });

  it('shows plain text and invalid JSON unchanged', () => {
    expect(resultText('Error executing tool: boom')).toBe('Error executing tool: boom');
    expect(resultText('{not json')).toBe('{not json');
  });
});
