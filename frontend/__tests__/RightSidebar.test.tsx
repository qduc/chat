/**
 * Tests for RightSidebar component
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { RightSidebar } from '../components/RightSidebar';

// Mock useSystemPrompts hook
const mockPrompts = {
  built_ins: [
    {
      id: 'builtin-1',
      name: 'Default Assistant',
      body: 'You are a helpful assistant.',
      read_only: true,
    },
    { id: 'builtin-2', name: 'Code Helper', body: 'You are a coding expert.', read_only: true },
  ],
  custom: [
    { id: 'custom-1', name: 'My Custom Prompt', body: 'Custom instructions here.' },
    { id: 'custom-2', name: 'Another Prompt', body: 'More instructions.' },
  ],
};

const mockUseSystemPrompts = {
  prompts: mockPrompts,
  loading: false,
  error: null as string | null,
  activePromptId: null,
  setActivePromptId: jest.fn(),
  hasUnsavedChanges: jest.fn(() => false),
  fetchPrompts: jest.fn(),
  createPrompt: jest.fn(() =>
    Promise.resolve({ id: 'new-1', name: 'New Prompt', body: 'content' })
  ),
  updatePrompt: jest.fn(() => Promise.resolve(true)),
  deletePrompt: jest.fn(() => Promise.resolve(true)),
  duplicatePrompt: jest.fn(),
  selectPrompt: jest.fn(() => Promise.resolve(true)),
  clearPrompt: jest.fn(),
  setInlineEdit: jest.fn(),
  clearInlineEdit: jest.fn(),
  saveInlineEdit: jest.fn(() => Promise.resolve(true)),
  discardInlineEdit: jest.fn(),
  getPromptById: jest.fn((id: string) => {
    const all = [...mockPrompts.built_ins, ...mockPrompts.custom];
    return all.find((p) => p.id === id) || null;
  }),
  getEffectivePromptContent: jest.fn((id: string) => {
    const all = [...mockPrompts.built_ins, ...mockPrompts.custom];
    const prompt = all.find((p) => p.id === id);
    return prompt?.body || '';
  }),
  inlineEdits: {},
};

jest.mock('../hooks/useSystemPrompts', () => ({
  useSystemPrompts: () => mockUseSystemPrompts,
}));

// Mock PromptDropdown
jest.mock('../app/components/promptManager/PromptDropdown', () => ({
  __esModule: true,
  default: ({ selectedPromptId, onSelectPrompt, onClearSelection }: any) => (
    <div data-testid="prompt-dropdown">
      <select
        value={selectedPromptId || ''}
        onChange={(e) => onSelectPrompt(e.target.value)}
        data-testid="prompt-select"
      >
        <option value="">Select a prompt</option>
        <option value="builtin-1">Default Assistant</option>
        <option value="builtin-2">Code Helper</option>
        <option value="custom-1">My Custom Prompt</option>
        <option value="custom-2">Another Prompt</option>
      </select>
      <button onClick={onClearSelection} data-testid="clear-selection">
        Clear
      </button>
    </div>
  ),
}));

// Mock modals
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

// Mock lucide-react
jest.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="chevron-left">←</span>,
  ChevronRight: () => <span data-testid="chevron-right">→</span>,
  RotateCcw: () => <span data-testid="rotate-ccw">↺</span>,
  X: () => <span data-testid="x-icon">✕</span>,
}));

describe('RightSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSystemPrompts.hasUnsavedChanges.mockReturnValue(false);
    mockUseSystemPrompts.getPromptById.mockImplementation((id: string) => {
      const all = [...mockPrompts.built_ins, ...mockPrompts.custom];
      return all.find((p) => p.id === id) || null;
    });
    mockUseSystemPrompts.getEffectivePromptContent.mockImplementation((id: string) => {
      const all = [...mockPrompts.built_ins, ...mockPrompts.custom];
      const prompt = all.find((p) => p.id === id);
      return prompt?.body || '';
    });
  });

  describe('Collapsed state', () => {
    it('renders collapsed sidebar with expand button', () => {
      render(<RightSidebar collapsed={true} />);

      const expandButton = screen.getByLabelText('Expand sidebar');
      expect(expandButton).toBeInTheDocument();
    });

    it('calls onToggleCollapse when expand button is clicked', async () => {
      const onToggleCollapse = jest.fn();
      render(<RightSidebar collapsed={true} onToggleCollapse={onToggleCollapse} />);

      const expandButton = screen.getByLabelText('Expand sidebar');
      await userEvent.click(expandButton);

      expect(onToggleCollapse).toHaveBeenCalled();
    });

    it('uses collapsedWidth when collapsed', () => {
      const { container } = render(<RightSidebar collapsed={true} collapsedWidth={48} />);

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveStyle({ width: '48px' });
    });
  });

  describe('Expanded state', () => {
    it('renders expanded sidebar with header', () => {
      render(<RightSidebar collapsed={false} />);

      expect(screen.getByText('System Prompts')).toBeInTheDocument();
    });

    it('renders prompt dropdown', () => {
      render(<RightSidebar collapsed={false} />);

      expect(screen.getByTestId('prompt-dropdown')).toBeInTheDocument();
    });

    it('renders content textarea', () => {
      render(<RightSidebar collapsed={false} />);

      expect(screen.getByLabelText('Prompt content')).toBeInTheDocument();
    });

    it('uses width when expanded', () => {
      const { container } = render(<RightSidebar collapsed={false} width={400} />);

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveStyle({ width: '400px' });
    });

    it('shows collapse button', () => {
      render(<RightSidebar collapsed={false} onToggleCollapse={jest.fn()} />);

      const collapseButton = screen.getByTitle('Collapse sidebar');
      expect(collapseButton).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('shows loading message when loading prompts', () => {
      mockUseSystemPrompts.prompts = null as any;
      const originalLoading = mockUseSystemPrompts.loading;
      mockUseSystemPrompts.loading = true;

      render(<RightSidebar collapsed={false} />);

      expect(screen.getByText('Loading prompts...')).toBeInTheDocument();

      mockUseSystemPrompts.loading = originalLoading;
      mockUseSystemPrompts.prompts = mockPrompts;
    });
  });

  describe('Error state', () => {
    it('shows error message when there is an error', () => {
      const originalError = mockUseSystemPrompts.error;
      mockUseSystemPrompts.error = 'Failed to load prompts';

      render(<RightSidebar collapsed={false} />);

      expect(screen.getByText(/Failed to load prompts/)).toBeInTheDocument();

      mockUseSystemPrompts.error = originalError;
    });
  });

  describe('Prompt selection', () => {
    it('calls onEffectivePromptChange when prompt is selected', async () => {
      const onEffectivePromptChange = jest.fn();
      render(<RightSidebar collapsed={false} onEffectivePromptChange={onEffectivePromptChange} />);

      const select = screen.getByTestId('prompt-select');
      await userEvent.selectOptions(select, 'custom-1');

      await waitFor(() => {
        expect(onEffectivePromptChange).toHaveBeenCalled();
      });
    });

    it('displays selected prompt content in textarea', async () => {
      render(<RightSidebar collapsed={false} conversationActivePromptId="custom-1" />);

      const textarea = screen.getByLabelText('Prompt content');
      expect(textarea).toHaveValue('Custom instructions here.');
    });

    it('clears selection when clear button is clicked', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          collapsed={false}
          conversationActivePromptId="custom-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );

      const clearButton = screen.getByLabelText('Clear prompt selection');
      await userEvent.click(clearButton);

      expect(onActivePromptIdChange).toHaveBeenCalledWith(null);
    });
  });

  describe('Content editing', () => {
    it('allows editing textarea content', async () => {
      render(<RightSidebar collapsed={false} />);

      const textarea = screen.getByLabelText('Prompt content');
      await userEvent.type(textarea, 'New content');

      expect(textarea).toHaveValue('New content');
    });

    it('shows Save As button', () => {
      render(<RightSidebar collapsed={false} />);

      expect(screen.getByText('Save As')).toBeInTheDocument();
    });

    it('opens Save As modal when clicking Save As', async () => {
      render(<RightSidebar collapsed={false} />);

      // Type some content first
      const textarea = screen.getByLabelText('Prompt content');
      await userEvent.type(textarea, 'Some content');

      const saveAsButton = screen.getByText('Save As');
      await userEvent.click(saveAsButton);

      expect(screen.getByTestId('save-as-modal')).toBeInTheDocument();
    });

    it('closes Save As modal when Cancel is clicked', async () => {
      render(<RightSidebar collapsed={false} />);

      const textarea = screen.getByLabelText('Prompt content');
      await userEvent.type(textarea, 'Some content');

      const saveAsButton = screen.getByText('Save As');
      await userEvent.click(saveAsButton);

      const cancelButton = screen.getByTestId('save-as-cancel');
      await userEvent.click(cancelButton);

      expect(screen.queryByTestId('save-as-modal')).not.toBeInTheDocument();
    });
  });

  describe('Save and Delete for custom prompts', () => {
    it('shows Save and Delete buttons for custom prompts', () => {
      render(<RightSidebar collapsed={false} conversationActivePromptId="custom-1" />);

      expect(screen.getByText('Save')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('does not show Save and Delete for built-in prompts', () => {
      render(<RightSidebar collapsed={false} conversationActivePromptId="builtin-1" />);

      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });

  describe('Revert changes', () => {
    it('has revert button for content', () => {
      render(<RightSidebar collapsed={false} />);

      const revertButton = screen.getByLabelText('Revert changes');
      expect(revertButton).toBeInTheDocument();
    });
  });

  describe('Footer', () => {
    it('shows "No active prompt selected" when no prompt is selected', () => {
      render(<RightSidebar collapsed={false} />);

      expect(screen.getByText('No active prompt selected')).toBeInTheDocument();
    });

    it('shows active prompt message when prompt is selected', () => {
      render(<RightSidebar collapsed={false} conversationActivePromptId="custom-1" />);

      expect(screen.getByText('Active prompt will be used for new messages')).toBeInTheDocument();
    });
  });

  describe('Unsaved changes', () => {
    it('shows unsaved changes indicator when there are changes', () => {
      mockUseSystemPrompts.hasUnsavedChanges.mockReturnValue(true);

      render(<RightSidebar collapsed={false} conversationActivePromptId="custom-1" />);

      expect(
        screen.getByText('Unsaved changes will be used for new conversations.')
      ).toBeInTheDocument();
    });

    it('shows different message for new prompts', async () => {
      render(<RightSidebar collapsed={false} />);

      const textarea = screen.getByLabelText('Prompt content');
      await userEvent.type(textarea, 'New content');

      expect(
        screen.getByText("Click 'Save As' to create a new prompt with this content.")
      ).toBeInTheDocument();
    });
  });

  describe('Conversation integration', () => {
    it('notifies parent of active prompt ID changes', async () => {
      const onActivePromptIdChange = jest.fn();
      render(
        <RightSidebar
          collapsed={false}
          conversationId="conv-1"
          onActivePromptIdChange={onActivePromptIdChange}
        />
      );

      const select = screen.getByTestId('prompt-select');
      await userEvent.selectOptions(select, 'custom-1');

      await waitFor(() => {
        expect(onActivePromptIdChange).toHaveBeenCalledWith('custom-1');
      });
    });

    it('uses conversation active prompt ID when provided', () => {
      render(
        <RightSidebar
          collapsed={false}
          conversationId="conv-1"
          conversationActivePromptId="builtin-2"
        />
      );

      const textarea = screen.getByLabelText('Prompt content');
      expect(textarea).toHaveValue('You are a coding expert.');
    });

    it('falls back to conversation system prompt when no ID', () => {
      render(
        <RightSidebar
          collapsed={false}
          conversationId="conv-1"
          conversationActivePromptId={null}
          conversationSystemPrompt="Custom system prompt from conversation"
        />
      );

      // When no prompt is selected but conversationSystemPrompt is provided,
      // the component falls back to showing that system prompt
      const textarea = screen.getByLabelText('Prompt content');
      expect(textarea).toHaveValue('Custom system prompt from conversation');
    });
  });

  describe('Width and resizing', () => {
    it('applies custom width', () => {
      const { container } = render(<RightSidebar collapsed={false} width={500} />);

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveStyle({ width: '500px' });
    });

    it('removes transition during resizing', () => {
      const { container } = render(<RightSidebar collapsed={false} isResizing={true} />);

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveStyle({ transition: 'none' });
    });

    it('has transition when not resizing', () => {
      const { container } = render(<RightSidebar collapsed={false} isResizing={false} />);

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveStyle({ transition: 'width 0.3s ease-in-out' });
    });
  });
});
