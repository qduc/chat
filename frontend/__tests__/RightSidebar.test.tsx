/**
 * Tests for the chat details panel (RightSidebar) and its System prompt section.
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { RightSidebar } from '../components/RightSidebar';
import { DETAILS_SECTIONS_STORAGE_KEY } from '../hooks/useDetailsSections';
import type { ChatMessage } from '../lib/types';
import type { ChatInfo } from '../lib/chatInfo';

const mockPrompts = {
  built_ins: [
    {
      id: 'builtin-1',
      slug: 'default',
      name: 'Default Assistant',
      body: 'You are a helpful assistant.',
      read_only: true,
      order: 1,
    },
    {
      id: 'builtin-2',
      slug: 'code',
      name: 'Code Helper',
      body: 'You are a coding expert.',
      read_only: true,
      order: 2,
    },
  ],
  custom: [
    {
      id: 'custom-1',
      name: 'My Custom Prompt',
      body: 'Custom instructions here.',
      usage_count: 1,
      last_used_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'custom-2',
      name: 'Another Prompt',
      body: 'More instructions.',
      usage_count: 0,
      last_used_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
};

const allPrompts = () => [...mockPrompts.built_ins, ...mockPrompts.custom];

const mockUseSystemPrompts = {
  prompts: mockPrompts as any,
  loading: false,
  error: null as string | null,
  activePromptId: null,
  setActivePromptId: jest.fn(),
  hasUnsavedChanges: jest.fn((_id: string) => false),
  fetchPrompts: jest.fn(),
  createPrompt: jest.fn(() =>
    Promise.resolve({ id: 'new-1', name: 'New Prompt', body: 'content' })
  ),
  updatePrompt: jest.fn(() => Promise.resolve(true)),
  deletePrompt: jest.fn(() => Promise.resolve(true)),
  duplicatePrompt: jest.fn(() => Promise.resolve(null)),
  selectPrompt: jest.fn(() => Promise.resolve(true)),
  clearPrompt: jest.fn(),
  setInlineEdit: jest.fn(),
  clearInlineEdit: jest.fn(),
  saveInlineEdit: jest.fn(() => Promise.resolve(true)),
  discardInlineEdit: jest.fn(),
  getPromptById: jest.fn((id: string) => allPrompts().find((p) => p.id === id) || null),
  getEffectivePromptContent: jest.fn(
    (id: string) => allPrompts().find((p) => p.id === id)?.body || ''
  ),
  inlineEdits: {} as Record<string, string>,
};

jest.mock('../hooks/useSystemPrompts', () => ({
  useSystemPrompts: () => mockUseSystemPrompts,
}));

jest.mock('../lib/modelInfo', () => ({
  fetchModelInfo: jest.fn(() =>
    Promise.resolve({
      model: 'm',
      context_window: 200000,
      max_output_tokens: null,
      pricing: null,
    })
  ),
}));

jest.mock('../lib/journal', () => ({
  fetchJournalPage: jest.fn(() => Promise.resolve(null)),
  deleteJournalEntry: jest.fn(),
}));

jest.mock('../app/components/promptManager/SaveAsModal', () => ({
  __esModule: true,
  default: ({ isOpen, onSave, onCancel, initialName }: any) =>
    isOpen ? (
      <div data-testid="save-as-modal">
        <input data-testid="save-as-name" defaultValue={initialName} />
        <button onClick={() => onSave('New Saved Prompt')} data-testid="save-as-confirm">
          Save
        </button>
        <button onClick={onCancel} data-testid="save-as-cancel">
          Cancel
        </button>
      </div>
    ) : null,
}));

jest.mock('../app/components/promptManager/UnsavedChangesModal', () => ({
  __esModule: true,
  default: ({ isOpen, onDiscard, onSave, onCancel }: any) =>
    isOpen ? (
      <div data-testid="unsaved-modal">
        <button onClick={onDiscard} data-testid="discard-changes">
          Discard
        </button>
        <button onClick={onSave} data-testid="save-changes">
          Save
        </button>
        <button onClick={onCancel} data-testid="cancel-changes">
          Cancel
        </button>
      </div>
    ) : null,
}));

const chatInfo: ChatInfo = {
  modelId: 'claude-sonnet',
  providerId: 'anthropic',
  providerName: 'Anthropic',
  reasoningLabel: 'High',
  tools: ['web_search', 'web_fetch'],
  paramsLabel: 'Default',
  streaming: true,
  startedAt: null,
};

const startedMessages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Hello' },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Hi',
    usage: {
      prompt_tokens: 30000,
      completion_tokens: 8000,
      cache_read_input_tokens: 24000,
      cost: { usd: 0.042, source: 'provider', cache_savings_usd: 0.065 },
    },
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"debounce"}' },
      },
    ],
    tool_outputs: [
      {
        tool_call_id: 'call-1',
        output:
          'Search Results:\n1. Debounce explained\n   Content: ...\n   URL: https://developer.mozilla.org/debounce\n',
        status: 'success',
      },
    ],
  },
];

function promptRadio(name: RegExp) {
  return screen.getByRole('radio', { name });
}

describe('RightSidebar (chat details panel)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockUseSystemPrompts.prompts = mockPrompts;
    mockUseSystemPrompts.loading = false;
    mockUseSystemPrompts.error = null;
    mockUseSystemPrompts.inlineEdits = {};
    mockUseSystemPrompts.hasUnsavedChanges.mockImplementation(() => false);
    mockUseSystemPrompts.getPromptById.mockImplementation(
      (id: string) => allPrompts().find((p) => p.id === id) || null
    );
    mockUseSystemPrompts.getEffectivePromptContent.mockImplementation(
      (id: string) => allPrompts().find((p) => p.id === id)?.body || ''
    );
  });

  describe('Panel shell', () => {
    it('is labelled "Chat details"', () => {
      render(<RightSidebar />);
      expect(screen.getByRole('complementary', { name: 'Chat details' })).toBeInTheDocument();
    });

    it('uses the given width', () => {
      const { container } = render(<RightSidebar width={400} />);
      expect(container.querySelector('aside')).toHaveStyle({ width: '400px' });
    });

    it('shows only System prompt and This chat on a fresh chat, with a quiet hint', () => {
      render(<RightSidebar chatInfo={chatInfo} />);
      expect(screen.getByRole('button', { name: /System prompt/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /This chat/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Usage/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Sources/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Files/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Memory/ })).not.toBeInTheDocument();
      expect(
        screen.getByText('Usage, sources and files show up here once the chat starts.')
      ).toBeInTheDocument();
    });

    it('shows usage and sources once the chat has data', async () => {
      render(<RightSidebar chatInfo={chatInfo} messages={startedMessages} />);
      expect(screen.getByRole('button', { name: /Usage/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sources/ })).toHaveTextContent('1');
      const link = screen.getByRole('link', { name: /Debounce explained/ });
      expect(link).toHaveAttribute('href', 'https://developer.mozilla.org/debounce');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByText(/saved \$0\.065 by caching/)).toBeInTheDocument();
      expect(await screen.findByRole('meter', { name: 'Context used' })).toHaveAttribute(
        'aria-valuenow',
        '19'
      );
    });

    it('renders the chat settings as a definition list', () => {
      render(<RightSidebar chatInfo={chatInfo} />);
      expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
      expect(screen.getByText('web_search, web_fetch')).toBeInTheDocument();
      expect(screen.getByText('Default · streaming')).toBeInTheDocument();
    });

    it('shows a mobile close button that closes the panel', async () => {
      const onToggleCollapse = jest.fn();
      render(<RightSidebar onToggleCollapse={onToggleCollapse} />);
      await userEvent.click(screen.getByRole('button', { name: 'Close chat details' }));
      expect(onToggleCollapse).toHaveBeenCalled();
    });
  });

  describe('Section collapse', () => {
    it('collapses a section, shows its summary and remembers it', async () => {
      const { unmount } = render(<RightSidebar chatInfo={chatInfo} />);
      const header = screen.getByRole('button', { name: /This chat/ });
      expect(header).toHaveAttribute('aria-expanded', 'true');

      await userEvent.click(header);

      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(header).toHaveTextContent('claude-sonnet · 2 tools');
      expect(screen.queryByText('web_search, web_fetch')).not.toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem(DETAILS_SECTIONS_STORAGE_KEY)!)).toMatchObject({
        chat: false,
        prompt: true,
      });

      unmount();
      render(<RightSidebar chatInfo={chatInfo} />);
      expect(screen.getByRole('button', { name: /This chat/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });

    it('ignores unreadable stored state', () => {
      window.localStorage.setItem(DETAILS_SECTIONS_STORAGE_KEY, '{not json');
      render(<RightSidebar chatInfo={chatInfo} />);
      expect(screen.getByRole('button', { name: /This chat/ })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });
  });

  describe('System prompt', () => {
    it('lists None, built-ins and custom prompts as one labelled radio group', () => {
      render(<RightSidebar />);
      const group = screen.getByRole('group', { name: 'System prompt' });
      const radios = within(group).getAllByRole('radio');
      expect(radios).toHaveLength(5);
      expect(radios[0]).toHaveAccessibleName('None');
      expect(radios[0]).toBeChecked();
      expect(radios[1]).toHaveAccessibleName(/Default Assistant.*Built-in/);
      // Custom prompts: most recently used first
      expect(radios[3]).toHaveAccessibleName('My Custom Prompt');
      expect(radios[4]).toHaveAccessibleName('Another Prompt');
    });

    it('selecting a radio activates the prompt and reports its content', async () => {
      const onEffectivePromptChange = jest.fn();
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          onEffectivePromptChange={onEffectivePromptChange}
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );

      await userEvent.click(promptRadio(/My Custom Prompt/));

      expect(onActivePromptIdChange).toHaveBeenCalledWith('custom-1');
      expect(onEffectivePromptChange).toHaveBeenCalledWith('Custom instructions here.');
      expect(promptRadio(/My Custom Prompt/)).toBeChecked();
      // The selected prompt expands with a preview and actions.
      expect(screen.getByText('Custom instructions here.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    });

    it('selecting None clears the active prompt', async () => {
      const onActivePromptIdChange = jest.fn();
      const onEffectivePromptChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
          onEffectivePromptChange={onEffectivePromptChange}
        />
      );

      await userEvent.click(promptRadio(/None/));

      expect(onActivePromptIdChange).toHaveBeenCalledWith(null);
      expect(onEffectivePromptChange).toHaveBeenLastCalledWith('');
    });

    it('in a conversation, selecting a prompt updates the active prompt id', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar conversationId="conv-1" onActivePromptIdChange={onActivePromptIdChange} />
      );
      await userEvent.click(promptRadio(/My Custom Prompt/));
      expect(mockUseSystemPrompts.setActivePromptId).toHaveBeenCalledWith('custom-1');
      expect(onActivePromptIdChange).toHaveBeenCalledWith('custom-1');
    });

    it('shows the "Edited" marker for prompts with unsaved inline edits', () => {
      mockUseSystemPrompts.hasUnsavedChanges.mockImplementation((id) => id === 'custom-1');
      render(<RightSidebar conversationActivePromptId="custom-1" />);
      expect(promptRadio(/My Custom Prompt/)).toHaveAccessibleName(/Edited/);
      expect(promptRadio(/Another Prompt/)).not.toHaveAccessibleName(/Edited/);
    });

    it('collapsed summary shows the active prompt name', async () => {
      render(<RightSidebar conversationActivePromptId="custom-1" />);
      const header = screen.getByRole('button', { name: /System prompt/ });
      await userEvent.click(header);
      expect(header).toHaveTextContent('My Custom Prompt');
    });

    it('shows a loading message while prompts load', () => {
      mockUseSystemPrompts.prompts = null;
      mockUseSystemPrompts.loading = true;
      render(<RightSidebar />);
      expect(screen.getByText('Loading prompts...')).toBeInTheDocument();
    });

    it('shows load errors', () => {
      mockUseSystemPrompts.error = 'Failed to load prompts';
      render(<RightSidebar />);
      expect(screen.getByText(/Failed to load prompts/)).toBeInTheDocument();
    });
  });

  describe('Editing a prompt', () => {
    it('edits through the inline-edit flow and shows count and note', async () => {
      const onEffectivePromptChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onEffectivePromptChange={onEffectivePromptChange}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
      const textarea = screen.getByLabelText('Prompt content');
      expect(textarea).toHaveValue('Custom instructions here.');
      expect(screen.getByText('25 characters')).toBeInTheDocument();
      expect(screen.getByText('Applies to new messages')).toBeInTheDocument();

      await userEvent.type(textarea, '!');

      expect(mockUseSystemPrompts.setInlineEdit).toHaveBeenCalledWith(
        'custom-1',
        'Custom instructions here.!'
      );
      expect(onEffectivePromptChange).toHaveBeenLastCalledWith('Custom instructions here.!');
    });

    it('built-in prompts say edits apply to this chat only and have no Save', async () => {
      render(<RightSidebar conversationActivePromptId="builtin-1" />);
      await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
      expect(screen.getByText('Built-in · edits apply to this chat only')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save as new' })).toBeInTheDocument();
    });

    it('Save is disabled without changes and saves inline edits', async () => {
      const { rerender } = render(<RightSidebar conversationActivePromptId="custom-1" />);
      await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      mockUseSystemPrompts.hasUnsavedChanges.mockImplementation((id) => id === 'custom-1');
      rerender(<RightSidebar conversationActivePromptId="custom-1" />);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockUseSystemPrompts.saveInlineEdit).toHaveBeenCalledWith('custom-1');
    });

    it('Revert restores the saved body instead of clearing the text', async () => {
      mockUseSystemPrompts.hasUnsavedChanges.mockImplementation((id) => id === 'custom-1');
      mockUseSystemPrompts.getEffectivePromptContent.mockImplementation((id) =>
        id === 'custom-1' ? 'Edited text' : ''
      );
      const onEffectivePromptChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onEffectivePromptChange={onEffectivePromptChange}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
      onEffectivePromptChange.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'Revert' }));

      expect(mockUseSystemPrompts.discardInlineEdit).toHaveBeenCalledWith('custom-1');
      expect(onEffectivePromptChange).toHaveBeenCalledWith('Custom instructions here.');
      expect(onEffectivePromptChange).not.toHaveBeenCalledWith('');
      expect(mockUseSystemPrompts.setInlineEdit).not.toHaveBeenCalled();
    });

    it('Save as new opens the save-as modal and creates a prompt', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Save as new' }));
      expect(screen.getByTestId('save-as-name')).toHaveValue('My Custom Prompt (Copy)');

      await userEvent.click(screen.getByTestId('save-as-confirm'));

      expect(mockUseSystemPrompts.createPrompt).toHaveBeenCalledWith({
        name: 'New Saved Prompt',
        body: 'Custom instructions here.',
      });
      await waitFor(() => expect(onActivePromptIdChange).toHaveBeenCalledWith('new-1'));
    });
  });

  describe('New prompt', () => {
    it('starts a blank draft that is saved via Save as new', async () => {
      const onEffectivePromptChange = jest.fn();
      render(<RightSidebar onEffectivePromptChange={onEffectivePromptChange} />);

      await userEvent.click(screen.getByRole('button', { name: 'New prompt' }));
      const textarea = screen.getByLabelText('Prompt content');
      expect(textarea).toHaveValue('');

      await userEvent.type(textarea, 'Be brief');
      expect(onEffectivePromptChange).toHaveBeenLastCalledWith('Be brief');

      await userEvent.click(screen.getByRole('button', { name: 'Save as new' }));
      await userEvent.click(screen.getByTestId('save-as-confirm'));
      expect(mockUseSystemPrompts.createPrompt).toHaveBeenCalledWith({
        name: 'New Saved Prompt',
        body: 'Be brief',
      });
    });

    it('Revert clears unsaved new-prompt text', async () => {
      const onEffectivePromptChange = jest.fn();
      render(<RightSidebar onEffectivePromptChange={onEffectivePromptChange} />);
      await userEvent.click(screen.getByRole('button', { name: 'New prompt' }));
      await userEvent.type(screen.getByLabelText('Prompt content'), 'Draft');

      await userEvent.click(screen.getByRole('button', { name: 'Revert' }));

      expect(onEffectivePromptChange).toHaveBeenLastCalledWith('');
      expect(screen.queryByLabelText('Prompt content')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New prompt' })).toBeInTheDocument();
    });

    it("shows a conversation's inline system prompt when no saved prompt is active", async () => {
      render(
        <RightSidebar
          conversationId="conv-1"
          conversationActivePromptId={null}
          conversationSystemPrompt="Custom system prompt from conversation"
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Prompt content')).toHaveValue(
          'Custom system prompt from conversation'
        )
      );
    });
  });

  describe('Unsaved changes on switch', () => {
    beforeEach(() => {
      mockUseSystemPrompts.hasUnsavedChanges.mockImplementation((id) => id === 'custom-1');
      mockUseSystemPrompts.inlineEdits = { 'custom-1': 'Edited text' };
    });

    it('asks before switching prompts and only switches after discarding', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );

      await userEvent.click(promptRadio(/Another Prompt/));

      expect(screen.getByTestId('unsaved-modal')).toBeInTheDocument();
      expect(onActivePromptIdChange).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('discard-changes'));

      expect(mockUseSystemPrompts.discardInlineEdit).toHaveBeenCalledWith('custom-1');
      expect(onActivePromptIdChange).toHaveBeenCalledWith('custom-2');
      expect(screen.queryByTestId('unsaved-modal')).not.toBeInTheDocument();
    });

    it('asks before switching to None, and Cancel keeps the selection', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );

      await userEvent.click(promptRadio(/None/));
      expect(screen.getByTestId('unsaved-modal')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('cancel-changes'));

      expect(onActivePromptIdChange).not.toHaveBeenCalled();
      expect(promptRadio(/My Custom Prompt/)).toBeChecked();
    });

    it('Save in the modal saves, then switches', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );
      await userEvent.click(promptRadio(/Another Prompt/));
      await userEvent.click(screen.getByTestId('save-changes'));

      expect(mockUseSystemPrompts.saveInlineEdit).toHaveBeenCalledWith('custom-1');
      await waitFor(() => expect(onActivePromptIdChange).toHaveBeenCalledWith('custom-2'));
    });
  });

  describe('Prompt actions menu', () => {
    it('duplicates the selected prompt', async () => {
      render(<RightSidebar conversationActivePromptId="builtin-1" />);
      await userEvent.click(
        screen.getByRole('button', { name: 'More actions for Default Assistant' })
      );
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
      expect(mockUseSystemPrompts.duplicatePrompt).toHaveBeenCalledWith('builtin-1');
    });

    it('offers no Delete for built-in prompts', async () => {
      render(<RightSidebar conversationActivePromptId="builtin-1" />);
      await userEvent.click(
        screen.getByRole('button', { name: 'More actions for Default Assistant' })
      );
      await screen.findByRole('menuitem', { name: 'Duplicate' });
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('deletes a custom prompt only after confirming in a dialog', async () => {
      const confirmSpy = jest.spyOn(window, 'confirm');
      const onEffectivePromptChange = jest.fn();
      render(
        <RightSidebar
          conversationActivePromptId="custom-1"
          onEffectivePromptChange={onEffectivePromptChange}
        />
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'More actions for My Custom Prompt' })
      );
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog', { name: 'Delete prompt?' });
      expect(within(dialog).getByText(/My Custom Prompt/)).toBeInTheDocument();
      expect(mockUseSystemPrompts.deletePrompt).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(mockUseSystemPrompts.deletePrompt).toHaveBeenCalledWith('custom-1');
      await waitFor(() => expect(onEffectivePromptChange).toHaveBeenLastCalledWith(''));
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('cancelling the delete dialog keeps the prompt', async () => {
      render(<RightSidebar conversationActivePromptId="custom-1" />);
      await userEvent.click(
        screen.getByRole('button', { name: 'More actions for My Custom Prompt' })
      );
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete prompt?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(mockUseSystemPrompts.deletePrompt).not.toHaveBeenCalled();
    });
  });
});
