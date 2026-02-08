/**
 * Tests for MessageInput component
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MessageInput, MessageInputRef } from '../components/MessageInput';
import type { ReasoningEffortLevel } from '../components/ui/QualitySlider';

// Mock the lib/api tools
jest.mock('../lib/api', () => ({
  tools: {
    getToolSpecs: jest.fn(() =>
      Promise.resolve({
        tools: [
          { name: 'search', description: 'Search the web' },
          { name: 'calculate', description: 'Perform calculations' },
        ],
        available_tools: ['search', 'calculate'],
        tool_api_key_status: {},
      })
    ),
  },
  images: {
    uploadImages: jest.fn(() => Promise.resolve([])),
    revokePreviewUrl: jest.fn(),
  },
  files: {
    uploadFiles: jest.fn(() => Promise.resolve([])),
  },
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Send: () => <span data-testid="send-icon">Send</span>,
  Loader2: () => <span data-testid="loader-icon">Loading</span>,
  Gauge: () => <span data-testid="gauge-icon">Gauge</span>,
  Wrench: () => <span data-testid="wrench-icon">Wrench</span>,
  Zap: () => <span data-testid="zap-icon">Zap</span>,
  Sliders: () => <span data-testid="sliders-icon">Sliders</span>,
  ImagePlus: () => <span data-testid="image-icon">Image</span>,
  FileText: () => <span data-testid="file-icon">File</span>,
  AudioLines: () => <span data-testid="audio-icon">Audio</span>,
  Paperclip: () => <span data-testid="paperclip-icon">Paperclip</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
  X: () => <span data-testid="x-icon">X</span>,
}));

// Mock UI components
jest.mock('../components/ui/Toggle', () => ({
  __esModule: true,
  default: ({ checked, onChange, ariaLabel }: any) => (
    <button
      aria-label={ariaLabel}
      data-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid="toggle"
    >
      Toggle
    </button>
  ),
}));

jest.mock('../components/ui/QualitySlider', () => ({
  __esModule: true,
  default: ({ value, onChange, disabled }: any) => (
    <select
      value={value || 'medium'}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid="quality-slider"
      aria-label="Reasoning Effort"
    >
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
  ),
}));

jest.mock('../components/ui/ImagePreview', () => ({
  ImagePreview: ({ images, onRemove }: any) => (
    <div data-testid="image-preview">
      {images?.map((img: any) => (
        <div key={img.id} data-testid={`image-${img.id}`}>
          {img.name}
          {onRemove && (
            <button onClick={() => onRemove(img.id)} data-testid={`remove-image-${img.id}`}>
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  ),
  ImageUploadZone: ({ children, onFiles }: any) => (
    <div
      data-testid="image-upload-zone"
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files || []);
        onFiles?.(files);
      }}
    >
      {children}
    </div>
  ),
}));

jest.mock('../components/ui/FilePreview', () => ({
  FilePreview: ({ files, onRemove }: any) => (
    <div data-testid="file-preview">
      {files?.map((f: any) => (
        <div key={f.id} data-testid={`file-${f.id}`}>
          {f.name}
          {onRemove && (
            <button onClick={() => onRemove(f.id)} data-testid={`remove-file-${f.id}`}>
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('../components/ui/AudioPreview', () => ({
  AudioPreview: ({ audios, onRemove }: any) => (
    <div data-testid="audio-preview">
      {audios?.map((a: any) => (
        <div key={a.id} data-testid={`audio-${a.id}`}>
          {a.name}
          {onRemove && (
            <button onClick={() => onRemove(a.id)} data-testid={`remove-audio-${a.id}`}>
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('../components/ui/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

jest.mock('../lib/audioUtils', () => ({
  inferAudioFormat: jest.fn(() => 'mp3'),
  isAudioFile: jest.fn((file) => file?.type?.startsWith('audio/')),
}));

// Default props
const defaultProps = {
  input: '',
  pending: { streaming: false, abort: null },
  onInputChange: jest.fn(),
  onSend: jest.fn(),
  onStop: jest.fn(),
  useTools: false,
  shouldStream: true,
  onUseToolsChange: jest.fn(),
  onShouldStreamChange: jest.fn(),
  model: 'gpt-4',
  reasoningEffort: 'medium' as ReasoningEffortLevel,
  onReasoningEffortChange: jest.fn(),
};

describe('MessageInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('renders textarea with placeholder', () => {
      render(<MessageInput {...defaultProps} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      expect(textarea).toBeInTheDocument();
    });

    it('renders send button', () => {
      render(<MessageInput {...defaultProps} />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeInTheDocument();
    });

    it('renders stream toggle', () => {
      render(<MessageInput {...defaultProps} />);

      expect(screen.getByTestId('zap-icon')).toBeInTheDocument();
    });

    it('renders quality slider', () => {
      render(<MessageInput {...defaultProps} />);

      expect(screen.getByTestId('quality-slider')).toBeInTheDocument();
    });

    it('shows disabled placeholder when disabled', () => {
      const disabledReason = 'Model unavailable';
      render(<MessageInput {...defaultProps} disabled={true} disabledReason={disabledReason} />);

      const textarea = screen.getByPlaceholderText(disabledReason);
      expect(textarea).toBeInTheDocument();
      expect(textarea).toBeDisabled();
    });
  });

  describe('Input handling', () => {
    it('calls onInputChange when typing', async () => {
      const onInputChange = jest.fn();
      render(<MessageInput {...defaultProps} onInputChange={onInputChange} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      await userEvent.type(textarea, 'Hello');

      expect(onInputChange).toHaveBeenCalled();
    });

    it('displays the input value', () => {
      render(<MessageInput {...defaultProps} input="Test message" />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      expect(textarea).toHaveValue('Test message');
    });

    it('calls onSend when Enter is pressed (not streaming)', () => {
      const onSend = jest.fn();
      render(<MessageInput {...defaultProps} input="Hello" onSend={onSend} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSend).toHaveBeenCalled();
    });

    it('does not call onSend when Shift+Enter is pressed', () => {
      const onSend = jest.fn();
      render(<MessageInput {...defaultProps} input="Hello" onSend={onSend} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(onSend).not.toHaveBeenCalled();
    });

    it('calls onStop when Enter is pressed while streaming', () => {
      const onStop = jest.fn();
      render(
        <MessageInput
          {...defaultProps}
          pending={{ streaming: true, abort: null }}
          onStop={onStop}
        />
      );

      const textarea = screen.getByPlaceholderText('Type your message...');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onStop).toHaveBeenCalled();
    });

    it('does not call onSend when Enter is pressed with no text or attachments', () => {
      const onSend = jest.fn();
      render(<MessageInput {...defaultProps} input="" onSend={onSend} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('Send button', () => {
    it('is disabled when input is empty', () => {
      render(<MessageInput {...defaultProps} input="" />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('is enabled when input has content', () => {
      render(<MessageInput {...defaultProps} input="Hello" />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });

    it('calls onSend when clicked', async () => {
      const onSend = jest.fn();
      render(<MessageInput {...defaultProps} input="Hello" onSend={onSend} />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      await userEvent.click(sendButton);

      expect(onSend).toHaveBeenCalled();
    });

    it('shows loading state when streaming', () => {
      render(<MessageInput {...defaultProps} pending={{ streaming: true, abort: null }} />);

      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('calls onStop when clicked while streaming', async () => {
      const onStop = jest.fn();
      render(
        <MessageInput
          {...defaultProps}
          pending={{ streaming: true, abort: null }}
          onStop={onStop}
        />
      );

      const stopButton = screen.getByRole('button', { name: /stop/i });
      await userEvent.click(stopButton);

      expect(onStop).toHaveBeenCalled();
    });
  });

  describe('Stream toggle', () => {
    it('calls onShouldStreamChange when clicked', async () => {
      const onShouldStreamChange = jest.fn();
      render(
        <MessageInput
          {...defaultProps}
          shouldStream={true}
          onShouldStreamChange={onShouldStreamChange}
        />
      );

      const streamButton = screen.getByTestId('zap-icon').closest('button');
      expect(streamButton).toBeTruthy();
      if (streamButton) {
        await userEvent.click(streamButton);
        expect(onShouldStreamChange).toHaveBeenCalledWith(false);
      }
    });
  });

  describe('Reasoning effort slider', () => {
    it('calls onReasoningEffortChange when changed', async () => {
      const onReasoningEffortChange = jest.fn();
      render(<MessageInput {...defaultProps} onReasoningEffortChange={onReasoningEffortChange} />);

      // Quality slider mock renders a select element
      const slider = screen.getByTestId('quality-slider');
      await userEvent.selectOptions(slider, 'high');

      expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
    });
  });

  describe('Attach button', () => {
    it('shows attach dropdown when clicked', async () => {
      render(
        <MessageInput {...defaultProps} onImagesChange={jest.fn()} onFilesChange={jest.fn()} />
      );

      const attachButton = screen.getByLabelText('Attach Files');
      await userEvent.click(attachButton);

      expect(screen.getByText('Upload Image')).toBeInTheDocument();
      expect(screen.getByText('Upload File')).toBeInTheDocument();
    });

    it('closes attach dropdown when clicking outside', async () => {
      render(<MessageInput {...defaultProps} onImagesChange={jest.fn()} />);

      const attachButton = screen.getByLabelText('Attach Files');
      await userEvent.click(attachButton);

      expect(screen.getByText('Upload Image')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByText('Upload Image')).not.toBeInTheDocument();
      });
    });
  });

  describe('Image previews', () => {
    it('shows image previews when images are attached', () => {
      const images = [{ id: 'img-1', name: 'test.png', url: 'http://example.com/test.png' }];
      render(<MessageInput {...defaultProps} images={images as any} onImagesChange={jest.fn()} />);

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
      expect(screen.getByTestId('image-img-1')).toBeInTheDocument();
    });

    it('calls onImagesChange when image is removed', async () => {
      const onImagesChange = jest.fn();
      const images = [{ id: 'img-1', name: 'test.png', url: 'http://example.com/test.png' }];

      render(
        <MessageInput {...defaultProps} images={images as any} onImagesChange={onImagesChange} />
      );

      const removeButton = screen.getByTestId('remove-image-img-1');
      await userEvent.click(removeButton);

      expect(onImagesChange).toHaveBeenCalled();
    });

    it('enables send button when images are attached without text', () => {
      const images = [{ id: 'img-1', name: 'test.png', url: 'http://example.com/test.png' }];
      render(
        <MessageInput
          {...defaultProps}
          input=""
          images={images as any}
          onImagesChange={jest.fn()}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('File previews', () => {
    it('shows file previews when files are attached', () => {
      const files = [{ id: 'file-1', name: 'test.txt', content: 'Test content' }];
      render(<MessageInput {...defaultProps} files={files as any} onFilesChange={jest.fn()} />);

      expect(screen.getByTestId('file-preview')).toBeInTheDocument();
      expect(screen.getByTestId('file-file-1')).toBeInTheDocument();
    });

    it('calls onFilesChange when file is removed', async () => {
      const onFilesChange = jest.fn();
      const files = [{ id: 'file-1', name: 'test.txt', content: 'Test content' }];

      render(<MessageInput {...defaultProps} files={files as any} onFilesChange={onFilesChange} />);

      const removeButton = screen.getByTestId('remove-file-file-1');
      await userEvent.click(removeButton);

      expect(onFilesChange).toHaveBeenCalled();
    });

    it('enables send button when files are attached without text', () => {
      const files = [{ id: 'file-1', name: 'test.txt', content: 'Test content' }];
      render(
        <MessageInput {...defaultProps} input="" files={files as any} onFilesChange={jest.fn()} />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('Audio previews', () => {
    it('shows audio previews when audios are attached', () => {
      const audios = [{ id: 'audio-1', name: 'test.mp3', url: 'blob:test' }];
      render(<MessageInput {...defaultProps} audios={audios as any} onAudiosChange={jest.fn()} />);

      expect(screen.getByTestId('audio-preview')).toBeInTheDocument();
      expect(screen.getByTestId('audio-audio-1')).toBeInTheDocument();
    });

    it('calls onAudiosChange when audio is removed', async () => {
      const onAudiosChange = jest.fn();
      const audios = [{ id: 'audio-1', name: 'test.mp3', url: 'blob:test' }];

      render(
        <MessageInput {...defaultProps} audios={audios as any} onAudiosChange={onAudiosChange} />
      );

      const removeButton = screen.getByTestId('remove-audio-audio-1');
      await userEvent.click(removeButton);

      expect(onAudiosChange).toHaveBeenCalled();
    });

    it('enables send button when audios are attached without text', () => {
      const audios = [{ id: 'audio-1', name: 'test.mp3', url: 'blob:test' }];
      render(
        <MessageInput
          {...defaultProps}
          input=""
          audios={audios as any}
          onAudiosChange={jest.fn()}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('Tools dropdown', () => {
    it('shows tools dropdown when tools button is clicked', async () => {
      render(<MessageInput {...defaultProps} enabledTools={[]} onEnabledToolsChange={jest.fn()} />);

      const toolsButton = screen.getByLabelText('Tools');
      await userEvent.click(toolsButton);

      await waitFor(() => {
        // "Search tools..." is a placeholder, not text content
        expect(screen.getByPlaceholderText('Search tools...')).toBeInTheDocument();
      });
    });

    it('closes tools dropdown when clicking outside', async () => {
      render(<MessageInput {...defaultProps} enabledTools={[]} onEnabledToolsChange={jest.fn()} />);

      const toolsButton = screen.getByLabelText('Tools');
      await userEvent.click(toolsButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search tools...')).toBeInTheDocument();
      });

      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Search tools...')).not.toBeInTheDocument();
      });
    });

    it('displays enabled tools count', async () => {
      render(
        <MessageInput
          {...defaultProps}
          enabledTools={['search', 'calculate']}
          onEnabledToolsChange={jest.fn()}
        />
      );

      // The component shows the count in the button
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('Ref forwarding', () => {
    it('exposes focus method via ref', () => {
      const ref = React.createRef<MessageInputRef>();
      render(<MessageInput {...defaultProps} ref={ref} />);

      expect(ref.current).toBeDefined();
      expect(typeof ref.current?.focus).toBe('function');
    });

    it('focuses textarea when focus method is called', () => {
      const ref = React.createRef<MessageInputRef>();
      render(<MessageInput {...defaultProps} ref={ref} />);

      const textarea = screen.getByPlaceholderText('Type your message...');
      ref.current?.focus();

      expect(document.activeElement).toBe(textarea);
    });
  });

  describe('Form submission', () => {
    it('calls onSend when form is submitted', () => {
      const onSend = jest.fn();
      render(<MessageInput {...defaultProps} input="Hello" onSend={onSend} />);

      const form = document.querySelector('form');
      expect(form).toBeTruthy();
      if (form) {
        fireEvent.submit(form);
        expect(onSend).toHaveBeenCalled();
      }
    });

    it('calls onStop when form is submitted while streaming', () => {
      const onStop = jest.fn();
      render(
        <MessageInput
          {...defaultProps}
          pending={{ streaming: true, abort: null }}
          onStop={onStop}
        />
      );

      const form = document.querySelector('form');
      expect(form).toBeTruthy();
      if (form) {
        fireEvent.submit(form);
        expect(onStop).toHaveBeenCalled();
      }
    });
  });

  describe('Disabled state', () => {
    it('disables all controls when disabled prop is true', () => {
      render(<MessageInput {...defaultProps} disabled={true} />);

      const textarea = screen.getByPlaceholderText(/unavailable/i);
      expect(textarea).toBeDisabled();

      const qualitySlider = screen.getByTestId('quality-slider');
      expect(qualitySlider).toBeDisabled();
    });

    it('disables controls during streaming', () => {
      render(<MessageInput {...defaultProps} pending={{ streaming: true, abort: null }} />);

      const qualitySlider = screen.getByTestId('quality-slider');
      expect(qualitySlider).toBeDisabled();
    });
  });

  describe('Custom request params', () => {
    it('shows custom params dropdown when clicked', async () => {
      const customParams = [{ id: 'param-1', label: 'High temp', params: { temperature: 1 } }];
      render(
        <MessageInput
          {...defaultProps}
          customRequestParams={customParams}
          onCustomRequestParamsIdChange={jest.fn()}
        />
      );

      const paramsButton = screen.getByLabelText('Custom request params');
      await userEvent.click(paramsButton);

      await waitFor(() => {
        expect(screen.getByText('Custom Params')).toBeInTheDocument();
        expect(screen.getByText('High temp')).toBeInTheDocument();
      });
    });

    it('displays selected custom params label', () => {
      const customParams = [{ id: 'param-1', label: 'High temp', params: { temperature: 1 } }];
      render(
        <MessageInput
          {...defaultProps}
          customRequestParams={customParams}
          customRequestParamsId={['param-1']}
          onCustomRequestParamsIdChange={jest.fn()}
        />
      );

      expect(screen.getByText('High temp')).toBeInTheDocument();
    });
  });
});
