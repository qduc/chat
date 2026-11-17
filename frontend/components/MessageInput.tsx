import { useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  Send,
  Loader2,
  Gauge,
  Wrench,
  Zap,
  Sliders,
  ImagePlus,
  FileText,
  AudioLines,
  Paperclip,
  Check,
  X,
} from 'lucide-react';
import type { PendingState } from '@/hooks/useChat';
import {
  images as imageUtils,
  files as filesApi,
  type ImageAttachment,
  type ImageUploadProgress,
  type FileAttachment,
  type FileUploadProgress,
  type AudioAttachment,
} from '../lib';
import { inferAudioFormat, isAudioFile } from '../lib/audioUtils';
import Toggle from './ui/Toggle';
import { Button, IconButton, buttonClasses, iconButtonClasses } from './ui/Button';
import { Input } from './ui/Input';
import { floatingItemClasses } from './ui/Menu';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import { cn } from '../lib/cn';
import QualitySlider from './ui/QualitySlider';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
import { FilePreview } from './ui/FilePreview';
import { AudioPreview } from './ui/AudioPreview';
import Tooltip from './ui/Tooltip';
import type { ReasoningEffortLevel, StoredReasoningEffort } from './ui/QualitySlider';
import type { CustomRequestParamPreset } from '../lib/types';

// Stable empty arrays to prevent infinite re-renders from default parameters
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_IMAGES_ARRAY: ImageAttachment[] = [];
const EMPTY_AUDIOS_ARRAY: AudioAttachment[] = [];
const EMPTY_FILES_ARRAY: FileAttachment[] = [];
const EMPTY_PARAMS_ARRAY: CustomRequestParamPreset[] = [];
const EMPTY_CAPABILITIES: Record<string, any> = {};

interface MessageInputProps {
  input: string;
  pending: PendingState;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  useTools: boolean;
  shouldStream: boolean;
  onUseToolsChange: (useTools: boolean) => void;
  onShouldStreamChange: (val: boolean) => void;
  enabledTools?: string[];
  onEnabledToolsChange?: (list: string[]) => void;
  customRequestParams?: CustomRequestParamPreset[];
  customRequestParamsId?: string[] | null;
  onCustomRequestParamsIdChange?: (ids: string[] | null) => void;
  model: string;
  reasoningEffort: StoredReasoningEffort;
  onReasoningEffortChange: (level: ReasoningEffortLevel) => void;
  modelCapabilities?: Record<string, any>; // Model capabilities from provider
  images?: ImageAttachment[];
  onImagesChange?: (images: ImageAttachment[]) => void;
  audios?: AudioAttachment[];
  onAudiosChange?: (audios: AudioAttachment[]) => void;
  files?: FileAttachment[];
  onFilesChange?: (files: FileAttachment[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  disableTextInput?: boolean;
}

export interface MessageInputRef {
  focus: () => void;
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(function MessageInput(
  {
    input,
    pending,
    onInputChange,
    onSend,
    onStop,
    shouldStream,
    onUseToolsChange,
    enabledTools = EMPTY_STRING_ARRAY,
    onEnabledToolsChange,
    customRequestParams = EMPTY_PARAMS_ARRAY,
    customRequestParamsId = null,
    onCustomRequestParamsIdChange,
    onShouldStreamChange,
    model,
    reasoningEffort,
    onReasoningEffortChange,
    modelCapabilities = EMPTY_CAPABILITIES,
    images = EMPTY_IMAGES_ARRAY,
    onImagesChange,
    audios = EMPTY_AUDIOS_ARRAY,
    onAudiosChange,
    files = EMPTY_FILES_ARRAY,
    onFilesChange,
    disabled = false,
    disabledReason = 'Selected models are unavailable. Refresh models to resume.',
    disableTextInput = false,
  },
  ref
) {
  // ===== REFS =====
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    },
  }));

  // ===== STATE =====
  const [toolsOpen, setToolsOpen] = useState(false);
  const [availableTools, setAvailableTools] = useState<{ name: string; description?: string }[]>(
    []
  );
  const [toolApiKeyStatus, setToolApiKeyStatus] = useState<
    Record<string, { hasApiKey: boolean; requiresApiKey: boolean; missingKeyLabel?: string }>
  >({});
  const [toolFilter, setToolFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [localSelected, setLocalSelected] = useState<string[]>(enabledTools);
  const [customParamsOpen, setCustomParamsOpen] = useState(false);
  const [localCustomParamsIds, setLocalCustomParamsIds] = useState<string[]>(
    Array.isArray(customRequestParamsId) ? customRequestParamsId : []
  );
  const [imageUploadProgress, setImageUploadProgress] = useState<ImageUploadProgress[]>([]);
  const [fileUploadProgress, setFileUploadProgress] = useState<FileUploadProgress[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);

  const generateId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
      }
    } catch {
      // ignore
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  };

  // ===== COMPUTED VALUES =====

  const selectedCustomParamsLabels = useMemo(() => {
    if (localCustomParamsIds.length === 0) return [];
    return localCustomParamsIds.map((id) => {
      const match = customRequestParams.find((preset) => preset.id === id || preset.label === id);
      return match?.label || id;
    });
  }, [customRequestParams, localCustomParamsIds]);

  const selectedCustomParamsLabel = useMemo(() => {
    if (selectedCustomParamsLabels.length === 0) return 'None';
    if (selectedCustomParamsLabels.length === 1) return selectedCustomParamsLabels[0];
    return `${selectedCustomParamsLabels.length} selected`;
  }, [selectedCustomParamsLabels]);

  const selectedCustomParamsTitle = useMemo(() => {
    if (selectedCustomParamsLabels.length === 0) return 'None';
    return selectedCustomParamsLabels.join(', ');
  }, [selectedCustomParamsLabels]);

  // Check if we can send (have text or any supported attachment)
  const canSend =
    input.trim().length > 0 || images.length > 0 || audios.length > 0 || files.length > 0;
  const inputLocked = disabled;
  const textareaLocked = disabled || disableTextInput;
  const canSubmit = canSend && !textareaLocked;
  const controlsDisabled = inputLocked || pending.streaming;

  // Helper to check if a tool is disabled due to missing API key
  const isToolDisabled = (name: string) => {
    const keyStatus = toolApiKeyStatus[name];
    return !!(keyStatus?.requiresApiKey && !keyStatus?.hasApiKey);
  };

  // Filtered tools for UI
  const filteredTools = availableTools
    .filter(
      (t) =>
        t.name.toLowerCase().includes(toolFilter.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(toolFilter.toLowerCase())
    )
    .sort((a, b) => {
      // Only reorder if disabled/enabled state differs
      const aDisabled = isToolDisabled(a.name);
      const bDisabled = isToolDisabled(b.name);
      if (aDisabled && !bDisabled) return 1;
      if (!aDisabled && bDisabled) return -1;
      // Keep stable order otherwise (don't reorder by selected state)
      return 0;
    });

  // ===== EFFECTS =====
  // Auto-grow textarea up to ~200px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(200, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);

  // Sync local selected tools with props
  useEffect(() => {
    setLocalSelected(enabledTools ?? []);
  }, [enabledTools]);

  useEffect(() => {
    setLocalCustomParamsIds(Array.isArray(customRequestParamsId) ? customRequestParamsId : []);
  }, [customRequestParamsId]);

  useEffect(() => {
    if (!textareaLocked) return;
    setToolsOpen(false);
    setAttachOpen(false);
    setCustomParamsOpen(false);
  }, [textareaLocked]);

  // Load tool specs for the selector UI
  useEffect(() => {
    let mounted = true;
    import('../lib/api')
      .then((mod) => {
        const apiTools = (mod as any).tools;
        if (!apiTools || typeof apiTools.getToolSpecs !== 'function') {
          if (mounted) setAvailableTools([]);
          return;
        }

        apiTools
          .getToolSpecs()
          .then((res: any) => {
            if (!mounted) return;
            const specs = Array.isArray(res?.tools) ? res.tools : [];
            const names = Array.isArray(res?.available_tools) ? res.available_tools : [];
            const apiKeyStatus = res?.tool_api_key_status || {};

            const tools =
              specs.length > 0
                ? specs.map((t: any) => ({
                    name: t.function?.name || t.name,
                    description: t.function?.description || t.description,
                  }))
                : names.map((n: string) => ({ name: n, description: undefined }));

            setAvailableTools(tools);
            setToolApiKeyStatus(apiKeyStatus);
          })
          .catch(() => {
            if (mounted) {
              setAvailableTools([]);
              setToolApiKeyStatus({});
            }
          });
      })
      .catch(() => {
        if (mounted) {
          setAvailableTools([]);
          setToolApiKeyStatus({});
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // ===== EVENT HANDLERS =====
  // Input handling
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (pending.streaming) {
        onStop();
      } else if (canSubmit) {
        onSend();
      }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (textareaLocked) return;
    if (!onImagesChange) return;

    const items = Array.from(event.clipboardData?.items || []);
    const files: File[] = [];

    items.forEach((item) => {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) {
          files.push(file);
        }
      }
    });

    if (files.length === 0) {
      const fileList = Array.from(event.clipboardData?.files || []);
      fileList.forEach((file) => {
        if (file.type.startsWith('image/')) {
          files.push(file);
        }
      });
    }

    if (files.length > 0) {
      event.preventDefault();
      void handleImageFiles(files);
    }
  };

  // Image handling
  const handleImageFiles = async (imageFiles: File[]) => {
    if (textareaLocked) return;
    if (!onImagesChange || !images) return;

    try {
      const uploadedImages = await imageUtils.uploadImages(imageFiles, setImageUploadProgress);
      onImagesChange([...images, ...uploadedImages]);
    } catch (error) {
      console.error('Image upload failed:', error);
      // TODO: Show error toast/notification
    }
  };

  const handleRemoveImage = (imageId: string) => {
    if (!onImagesChange || !images) return;

    const imageToRemove = images.find((img) => img.id === imageId);
    if (imageToRemove) {
      // Revoke blob URL to free memory
      imageUtils.revokePreviewUrl(imageToRemove.url);
      onImagesChange(images.filter((img) => img.id !== imageId));
    }
  };

  const handleImageUploadClick = () => {
    if (textareaLocked) return;
    imageInputRef.current?.click();
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (textareaLocked) return;
    const imageFiles = Array.from(e.target.files || []);
    if (imageFiles.length > 0) {
      handleImageFiles(imageFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // File handling
  const handleFileFiles = async (textFiles: File[]) => {
    if (textareaLocked) return;
    if (!onFilesChange || !files) return;

    try {
      const uploadedFiles = await filesApi.uploadFiles(textFiles, setFileUploadProgress);
      onFilesChange([...files, ...uploadedFiles]);
    } catch (error) {
      console.error('File upload failed:', error);
      // TODO: Show error toast/notification
    }
  };

  const handleRemoveFile = (fileId: string) => {
    if (!onFilesChange || !files) return;
    onFilesChange(files.filter((f) => f.id !== fileId));
  };

  const handleFileUploadClick = () => {
    if (textareaLocked) return;
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (textareaLocked) return;
    const textFiles = Array.from(e.target.files || []);
    if (textFiles.length > 0) {
      handleFileFiles(textFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // Audio handling (client-side; encoded to base64 when sending)
  const handleAudioFiles = (audioFiles: File[]) => {
    if (textareaLocked) return;
    if (!onAudiosChange) return;

    const next = audioFiles
      .filter((f) => isAudioFile(f))
      .map((file) => {
        const url = URL.createObjectURL(file);
        return {
          id: generateId(),
          file,
          url,
          name: file.name,
          size: file.size,
          type: file.type,
          format: inferAudioFormat(file),
        } as AudioAttachment;
      });

    if (next.length > 0) {
      onAudiosChange([...(audios || []), ...next]);
    }
  };

  const handleRemoveAudio = (audioId: string) => {
    if (!onAudiosChange) return;
    const audioToRemove = (audios || []).find((a) => a.id === audioId);
    if (audioToRemove?.url) {
      try {
        URL.revokeObjectURL(audioToRemove.url);
      } catch {
        // ignore
      }
    }
    onAudiosChange((audios || []).filter((a) => a.id !== audioId));
  };

  const handleAudioUploadClick = () => {
    if (textareaLocked) return;
    audioInputRef.current?.click();
  };

  const handleAudioInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (textareaLocked) return;
    const audioFiles = Array.from(e.target.files || []);
    if (audioFiles.length > 0) {
      handleAudioFiles(audioFiles);
    }
    e.target.value = '';
  };

  // Combined file handler for drag and drop (both images and text files)
  const handleDroppedFiles = async (droppedFiles: File[]) => {
    if (textareaLocked) return;
    // Separate images, audio, and (likely) text files
    const imageFiles = droppedFiles.filter((file) => file.type.startsWith('image/'));
    const audioFiles = droppedFiles.filter((file) => isAudioFile(file));
    const textFiles = droppedFiles.filter(
      (file) => !file.type.startsWith('image/') && !isAudioFile(file)
    );

    // Handle images
    if (imageFiles.length > 0 && onImagesChange) {
      void handleImageFiles(imageFiles);
    }

    // Handle text files
    if (textFiles.length > 0 && onFilesChange) {
      void handleFileFiles(textFiles);
    }

    // Handle audio
    if (audioFiles.length > 0 && onAudiosChange) {
      handleAudioFiles(audioFiles);
    }
  };

  // ===== RENDER =====
  const hasAttachments = images.length > 0 || files.length > 0 || audios.length > 0;
  const chipClasses = (active: boolean) =>
    cn(
      'max-w-32 truncate rounded-full px-2 text-xs',
      active ? 'bg-emphasis text-fg' : 'text-fg-muted'
    );
  const panelHeaderClasses = 'flex items-center justify-between gap-3 border-b border-line p-4';
  const panelRowClasses =
    'flex w-full items-start gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-muted focus-ring-inset disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <ImageUploadZone
      onFiles={handleDroppedFiles}
      disabled={controlsDisabled}
      fullPage={true}
      clickToUpload={false} // Avoid overlay input intercepting hover events (tooltips)
      fileFilter={() => true} // Accept all files, we'll sort them in handleDroppedFiles
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending.streaming) {
            onStop();
          } else if (canSubmit) {
            onSend();
          }
        }}
      >
        <div className="relative rounded-card border border-line-strong bg-surface transition-colors has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:-outline-offset-1 has-[textarea:focus-visible]:outline-focus">
          {/* ===== ATTACHMENT PREVIEWS ===== */}
          {images.length > 0 && (
            <div className="border-b border-line p-3">
              <ImagePreview
                images={images}
                uploadProgress={imageUploadProgress}
                onRemove={onImagesChange ? handleRemoveImage : undefined}
              />
            </div>
          )}
          {files.length > 0 && (
            <div className="border-b border-line p-3">
              <FilePreview
                files={files}
                uploadProgress={fileUploadProgress}
                onRemove={onFilesChange ? handleRemoveFile : undefined}
              />
            </div>
          )}
          {audios.length > 0 && (
            <div className="border-b border-line p-3">
              <AudioPreview
                audios={audios}
                onRemove={onAudiosChange ? handleRemoveAudio : undefined}
              />
            </div>
          )}

          {/* ===== TEXT INPUT ===== */}
          <div className="flex items-start gap-2 p-3">
            {(onImagesChange || onFilesChange || onAudiosChange) && (
              <>
                <Popover open={attachOpen} onOpenChange={setAttachOpen} modal="trap-focus">
                  <Tooltip content="Attach files" disabled={attachOpen}>
                    <PopoverTrigger
                      aria-label="Attach Files"
                      disabled={controlsDisabled}
                      className={iconButtonClasses({
                        size: 'sm',
                        className: hasAttachments ? 'bg-emphasis text-fg' : undefined,
                      })}
                    >
                      <Paperclip />
                    </PopoverTrigger>
                  </Tooltip>
                  <PopoverContent side="top" align="start" ariaLabel="Attach" className="w-56 p-1">
                    {onImagesChange && (
                      <button
                        type="button"
                        disabled={textareaLocked}
                        onClick={() => {
                          setAttachOpen(false);
                          handleImageUploadClick();
                        }}
                        className={floatingItemClasses}
                      >
                        <ImagePlus /> Upload Image
                      </button>
                    )}
                    {onAudiosChange && (
                      <button
                        type="button"
                        disabled={textareaLocked}
                        onClick={() => {
                          setAttachOpen(false);
                          handleAudioUploadClick();
                        }}
                        className={floatingItemClasses}
                      >
                        <AudioLines /> Upload Audio
                      </button>
                    )}
                    {onFilesChange && (
                      <button
                        type="button"
                        disabled={textareaLocked}
                        onClick={() => {
                          setAttachOpen(false);
                          handleFileUploadClick();
                        }}
                        className={floatingItemClasses}
                      >
                        <FileText /> Upload File
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
                {/* Hidden inputs */}
                {onImagesChange && (
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageInputChange}
                  />
                )}
                {onFilesChange && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                )}
                {onAudiosChange && (
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    className="hidden"
                    onChange={handleAudioInputChange}
                  />
                )}
              </>
            )}

            <textarea
              ref={inputRef}
              aria-label="Message"
              className="min-h-8 flex-1 resize-none bg-transparent py-1 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none disabled:cursor-not-allowed"
              placeholder={
                textareaLocked
                  ? disableTextInput
                    ? 'Change settings below and click Generate Response'
                    : disabledReason
                  : 'Type your message...'
              }
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              rows={1}
              disabled={textareaLocked}
              aria-disabled={textareaLocked}
              title={
                textareaLocked
                  ? disableTextInput
                    ? 'Consecutive user messages are not allowed. Use Generate Response instead.'
                    : disabledReason
                  : undefined
              }
            />
          </div>

          {/* ===== CONTROLS BAR ===== */}
          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto *:shrink-0">
              <Tooltip content="Reasoning effort level">
                <QualitySlider
                  value={reasoningEffort}
                  onChange={onReasoningEffortChange}
                  icon={<Gauge />}
                  ariaLabel="Reasoning Effort"
                  className="shrink-0"
                  disabled={controlsDisabled}
                />
              </Tooltip>

              <Tooltip content="Stream responses in real-time">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={shouldStream}
                  aria-label="Stream"
                  onClick={() => {
                    if (controlsDisabled) return;
                    onShouldStreamChange(!shouldStream);
                  }}
                  disabled={controlsDisabled}
                  className={cn('px-2', shouldStream && 'bg-emphasis text-fg')}
                >
                  <Zap className={shouldStream ? 'fill-current' : undefined} />
                  <span className="hidden sm:inline">Stream</span>
                </Button>
              </Tooltip>

              <div aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line md:block" />

              {/* Custom params selector */}
              <Popover
                open={customParamsOpen}
                onOpenChange={setCustomParamsOpen}
                modal="trap-focus"
              >
                <Tooltip content="Select custom request params" disabled={customParamsOpen}>
                  <PopoverTrigger
                    aria-label="Custom request params"
                    disabled={controlsDisabled}
                    className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-2' })}
                  >
                    <Sliders />
                    <span
                      className={chipClasses(localCustomParamsIds.length > 0)}
                      title={selectedCustomParamsTitle}
                    >
                      {selectedCustomParamsLabel}
                    </span>
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent side="top" align="start" ariaLabel="Custom Params" className="w-80">
                  <div className={panelHeaderClasses}>
                    <div>
                      <div className="text-sm font-medium text-fg">Custom Params</div>
                      <div className="text-xs text-fg-muted">
                        {customRequestParams.length} presets
                      </div>
                    </div>
                  </div>
                  <div className="flex max-h-72 flex-col gap-1 overflow-y-auto p-1">
                    <button
                      type="button"
                      aria-pressed={localCustomParamsIds.length === 0}
                      onClick={() => {
                        setLocalCustomParamsIds([]);
                        onCustomRequestParamsIdChange?.(null);
                      }}
                      disabled={controlsDisabled}
                      className={cn(panelRowClasses, 'text-sm text-fg')}
                    >
                      <span className="flex-1">None</span>
                      {localCustomParamsIds.length === 0 && (
                        <Check className="size-4 text-fg-muted" />
                      )}
                    </button>
                    {customRequestParams.length === 0 && (
                      <p className="px-3 py-2 text-xs text-fg-muted">
                        No presets configured. Add them in Settings → Advanced.
                      </p>
                    )}
                    {customRequestParams.map((preset) => {
                      const isActive = localCustomParamsIds.some(
                        (item) => item === preset.id || item === preset.label
                      );
                      return (
                        <Tooltip
                          key={preset.id}
                          placement="right"
                          delay={300}
                          className="w-full"
                          content={
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="font-medium">{preset.label}</div>
                              <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
                                {JSON.stringify(preset.params, null, 2)}
                              </pre>
                            </div>
                          }
                        >
                          <button
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => {
                              const nextIds = isActive
                                ? localCustomParamsIds.filter(
                                    (item) => item !== preset.id && item !== preset.label
                                  )
                                : Array.from(new Set([...localCustomParamsIds, preset.id]));
                              setLocalCustomParamsIds(nextIds);
                              onCustomRequestParamsIdChange?.(nextIds.length > 0 ? nextIds : null);
                            }}
                            disabled={controlsDisabled}
                            className={cn(panelRowClasses, isActive && 'bg-muted')}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className={cn('text-sm text-fg', isActive && 'font-medium')}>
                                {preset.label}
                              </span>
                              <span className="truncate font-mono text-xs text-fg-subtle">
                                {JSON.stringify(preset.params)}
                              </span>
                            </span>
                            {isActive && <Check className="size-4 shrink-0 text-fg-muted" />}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {localCustomParamsIds.length > 0 && (
                <IconButton
                  label="Clear custom params"
                  title="Clear custom params"
                  size="sm"
                  className="size-7"
                  onClick={() => {
                    setLocalCustomParamsIds([]);
                    onCustomRequestParamsIdChange?.(null);
                  }}
                >
                  <X />
                </IconButton>
              )}

              {/* Tools selector */}
              <Popover open={toolsOpen} onOpenChange={setToolsOpen} modal="trap-focus">
                <Tooltip content="Select tools to enable" disabled={toolsOpen}>
                  <PopoverTrigger
                    aria-label="Tools"
                    disabled={controlsDisabled}
                    className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-2' })}
                  >
                    <Wrench />
                    <span className={chipClasses(localSelected.length > 0)}>
                      {localSelected.length || 'None'}
                    </span>
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent
                  side="top"
                  align="start"
                  ariaLabel="Tools"
                  initialFocus={searchInputRef}
                  className="flex w-md flex-col"
                >
                  <div className={panelHeaderClasses}>
                    <div className="flex items-baseline gap-3">
                      <div className="text-sm font-medium text-fg">Tools</div>
                      <div className="text-xs text-fg-muted">{availableTools.length} available</div>
                    </div>
                    <Toggle
                      ariaLabel="Enable tools"
                      checked={localSelected.length > 0}
                      disabled={controlsDisabled}
                      onChange={(v: boolean) => {
                        if (controlsDisabled) return;
                        if (!v) {
                          setLocalSelected([]);
                          onEnabledToolsChange?.([]);
                          onUseToolsChange?.(false);
                        } else if (availableTools.length > 0) {
                          const all = availableTools
                            .filter((t) => !isToolDisabled(t.name))
                            .map((t) => t.name);
                          setLocalSelected(all);
                          onEnabledToolsChange?.(all);
                          onUseToolsChange?.(all.length > 0);
                        }
                      }}
                    />
                  </div>

                  <div className="flex shrink-0 flex-col gap-3 border-b border-line p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        ref={searchInputRef}
                        type="text"
                        aria-label="Search tools"
                        value={toolFilter}
                        onChange={(e) => setToolFilter(e.target.value)}
                        disabled={controlsDisabled}
                        placeholder="Search tools..."
                        className="flex-1"
                      />
                      <span className="text-xs whitespace-nowrap text-fg-muted">
                        {filteredTools.length} visible
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (inputLocked) return;
                          const all = availableTools
                            .filter((t) => !isToolDisabled(t.name))
                            .map((t) => t.name);
                          setLocalSelected(all);
                          onEnabledToolsChange?.(all);
                          onUseToolsChange?.(all.length > 0);
                        }}
                        disabled={controlsDisabled}
                      >
                        Select all
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (inputLocked) return;
                          const visibleIds = filteredTools
                            .filter((t) => !isToolDisabled(t.name))
                            .map((t) => t.name);
                          const next = [...new Set([...localSelected, ...visibleIds])];
                          setLocalSelected(next);
                          onEnabledToolsChange?.(next);
                          onUseToolsChange?.(next.length > 0);
                        }}
                        disabled={controlsDisabled}
                      >
                        Select visible
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (inputLocked) return;
                          setLocalSelected([]);
                          onEnabledToolsChange?.([]);
                          onUseToolsChange?.(false);
                        }}
                        disabled={controlsDisabled}
                      >
                        Clear
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (inputLocked) return;
                          const visibleIds = new Set(filteredTools.map((t) => t.name));
                          const next = localSelected.filter((x) => !visibleIds.has(x));
                          setLocalSelected(next);
                          onEnabledToolsChange?.(next);
                          onUseToolsChange?.(next.length > 0);
                        }}
                        disabled={controlsDisabled}
                      >
                        Clear visible
                      </Button>
                    </div>
                  </div>

                  <div className="scrollbar-thin max-h-80 overflow-y-auto overscroll-contain p-1">
                    {availableTools.length === 0 && (
                      <p className="p-4 text-center text-sm text-fg-muted">No tools available</p>
                    )}
                    <div className="flex flex-col gap-1">
                      {filteredTools.map((t) => {
                        const id = t.name;
                        const checked = localSelected.includes(id);
                        const keyStatus = toolApiKeyStatus[id];
                        const isDisabled = keyStatus?.requiresApiKey && !keyStatus?.hasApiKey;
                        const disabledTooltip = isDisabled
                          ? `This tool requires ${
                              keyStatus?.missingKeyLabel || 'an API key'
                            }. Please configure it in Settings.`
                          : undefined;

                        const toolButton = (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={checked}
                            onClick={() => {
                              if (inputLocked) return;
                              if (isDisabled) return;
                              const next = checked
                                ? localSelected.filter((x) => x !== id)
                                : [...localSelected, id];
                              setLocalSelected(next);
                              onEnabledToolsChange?.(next);
                              onUseToolsChange?.(next.length > 0);
                            }}
                            disabled={isDisabled}
                            className={cn(panelRowClasses, checked && 'bg-muted')}
                          >
                            <span
                              aria-hidden="true"
                              className="flex size-7 shrink-0 items-center justify-center rounded-control border border-line text-xs font-medium text-fg-muted"
                            >
                              {t.name?.charAt(0)?.toUpperCase() || 'T'}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="text-sm font-medium text-fg">{t.name}</span>
                              {t.description &&
                                (isDisabled ? (
                                  <span className="line-clamp-2 text-xs text-fg-muted">
                                    {t.description}
                                  </span>
                                ) : (
                                  <Tooltip content={t.description}>
                                    <span className="line-clamp-2 text-xs text-fg-muted">
                                      {t.description}
                                    </span>
                                  </Tooltip>
                                ))}
                            </span>
                            {checked && (
                              <Check aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                            )}
                          </button>
                        );

                        return isDisabled && disabledTooltip ? (
                          <Tooltip key={id} content={disabledTooltip}>
                            {toolButton}
                          </Tooltip>
                        ) : (
                          toolButton
                        );
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              {localSelected.length > 0 && (
                <IconButton
                  label="Clear enabled tools"
                  title="Clear enabled tools"
                  size="sm"
                  className="size-7"
                  onClick={() => {
                    setLocalSelected([]);
                    onEnabledToolsChange?.([]);
                    onUseToolsChange?.(false);
                  }}
                >
                  <X />
                </IconButton>
              )}
            </div>

            {/* ===== SEND BUTTON ===== */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (pending.streaming) {
                  onStop();
                } else if (canSubmit) {
                  onSend();
                }
              }}
              disabled={(!canSend || textareaLocked) && !pending.streaming}
              aria-label={pending.streaming ? 'Stop' : 'Send'}
            >
              {pending.streaming ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span className="hidden sm:inline">Stop</span>
                </>
              ) : (
                <>
                  <Send />
                  <span className="hidden sm:inline">Send</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </ImageUploadZone>
  );
});
