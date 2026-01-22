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
} from 'lucide-react';
import type { PendingState } from '@/hooks/useChat';
import {
  images as imageUtils,
  files as filesApi,
  supportsReasoningControls,
  type ImageAttachment,
  type ImageUploadProgress,
  type FileAttachment,
  type FileUploadProgress,
  type AudioAttachment,
} from '../lib';
import { inferAudioFormat, isAudioFile } from '../lib/audioUtils';
import Toggle from './ui/Toggle';
import QualitySlider from './ui/QualitySlider';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
import { FilePreview } from './ui/FilePreview';
import { AudioPreview } from './ui/AudioPreview';
import Tooltip from './ui/Tooltip';
import type { QualityLevel } from './ui/QualitySlider';
import type { CustomRequestParamPreset } from '../lib/types';

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
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  modelCapabilities?: Record<string, any>; // Model capabilities from provider
  images?: ImageAttachment[];
  onImagesChange?: (images: ImageAttachment[]) => void;
  audios?: AudioAttachment[];
  onAudiosChange?: (audios: AudioAttachment[]) => void;
  files?: FileAttachment[];
  onFilesChange?: (files: FileAttachment[]) => void;
  disabled?: boolean;
  disabledReason?: string;
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
    enabledTools = [],
    onEnabledToolsChange,
    customRequestParams = [],
    customRequestParamsId = null,
    onCustomRequestParamsIdChange,
    onShouldStreamChange,
    model,
    qualityLevel,
    onQualityLevelChange,
    modelCapabilities = {},
    images = [],
    onImagesChange,
    audios = [],
    onAudiosChange,
    files = [],
    onFilesChange,
    disabled = false,
    disabledReason = 'Selected models are unavailable. Refresh models to resume.',
  },
  ref
) {
  // ===== REFS =====
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsDropdownRef = useRef<HTMLDivElement | null>(null);
  const customParamsDropdownRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachDropdownRef = useRef<HTMLDivElement | null>(null);

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
  // Check if model supports thinking/reasoning
  const supportsThinking = useMemo(() => {
    return supportsReasoningControls(model, modelCapabilities);
  }, [model, modelCapabilities]);

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

  // Check if we can send (have text or images)
  const canSend = input.trim().length > 0 || images.length > 0;
  const inputLocked = disabled;
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

  // Click outside to close tools dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };

    if (toolsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [toolsOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        customParamsDropdownRef.current &&
        !customParamsDropdownRef.current.contains(event.target as Node)
      ) {
        setCustomParamsOpen(false);
      }
    };

    if (customParamsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [customParamsOpen]);

  // Focus search input when tools open
  useEffect(() => {
    if (toolsOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [toolsOpen]);

  // Click outside to close attach dropdown

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachDropdownRef.current && !attachDropdownRef.current.contains(event.target as Node)) {
        setAttachOpen(false);
      }
    };

    if (attachOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [attachOpen]);

  useEffect(() => {
    if (!inputLocked) return;
    setToolsOpen(false);
    setAttachOpen(false);
    setCustomParamsOpen(false);
  }, [inputLocked]);

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
      } else if (!inputLocked) {
        onSend();
      }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (inputLocked) return;
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
    if (inputLocked) return;
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
    if (inputLocked) return;
    imageInputRef.current?.click();
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inputLocked) return;
    const imageFiles = Array.from(e.target.files || []);
    if (imageFiles.length > 0) {
      handleImageFiles(imageFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // File handling
  const handleFileFiles = async (textFiles: File[]) => {
    if (inputLocked) return;
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
    if (inputLocked) return;
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inputLocked) return;
    const textFiles = Array.from(e.target.files || []);
    if (textFiles.length > 0) {
      handleFileFiles(textFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // Audio handling (client-side; encoded to base64 when sending)
  const handleAudioFiles = (audioFiles: File[]) => {
    if (inputLocked) return;
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
    if (inputLocked) return;
    audioInputRef.current?.click();
  };

  const handleAudioInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inputLocked) return;
    const audioFiles = Array.from(e.target.files || []);
    if (audioFiles.length > 0) {
      handleAudioFiles(audioFiles);
    }
    e.target.value = '';
  };

  // Combined file handler for drag and drop (both images and text files)
  const handleDroppedFiles = async (droppedFiles: File[]) => {
    if (inputLocked) return;
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
  return (
    <ImageUploadZone
      onFiles={handleDroppedFiles}
      disabled={controlsDisabled}
      fullPage={true}
      clickToUpload={false} // Avoid overlay input intercepting hover events (tooltips)
      fileFilter={() => true} // Accept all files, we'll sort them in handleDroppedFiles
    >
      <form
        className=""
        onSubmit={(e) => {
          e.preventDefault();
          if (pending.streaming) {
            onStop();
          } else if (!inputLocked) {
            onSend();
          }
        }}
      >
        <div>
          <div className="relative rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm transition-shadow duration-300 focus-within:shadow-md focus-within:border-zinc-300 dark:focus-within:border-zinc-700">
            {/* ===== IMAGE PREVIEWS ===== */}
            {images.length > 0 && (
              <div className="p-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <ImagePreview
                  images={images}
                  uploadProgress={imageUploadProgress}
                  onRemove={onImagesChange ? handleRemoveImage : undefined}
                />
              </div>
            )}

            {/* ===== FILE PREVIEWS ===== */}
            {files.length > 0 && (
              <div className="p-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <FilePreview
                  files={files}
                  uploadProgress={fileUploadProgress}
                  onRemove={onFilesChange ? handleRemoveFile : undefined}
                />
              </div>
            )}

            {/* ===== AUDIO PREVIEWS ===== */}
            {audios.length > 0 && (
              <div className="p-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <AudioPreview
                  audios={audios}
                  onRemove={onAudiosChange ? handleRemoveAudio : undefined}
                />
              </div>
            )}

            {/* ===== TEXT INPUT WITH IMAGE/FILE UPLOAD ===== */}
            <div className="flex items-start gap-3 p-3 sm:p-4">
              {/* Attach button */}
              {(onImagesChange || onFilesChange || onAudiosChange) && (
                <div className="relative" ref={attachDropdownRef}>
                  <Tooltip content="Attach files" disabled={attachOpen}>
                    <button
                      type="button"
                      onClick={() => setAttachOpen(!attachOpen)}
                      disabled={controlsDisabled}
                      className={`flex-shrink-0 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                        images.length > 0 || files.length > 0 || audios.length > 0
                          ? 'text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                      aria-label="Attach Files"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  {attachOpen && (
                    <div className="absolute bottom-full mb-2 left-0 w-48 sm:w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl p-1.5 z-50">
                      {onImagesChange && (
                        <button
                          type="button"
                          onClick={() => {
                            if (inputLocked) return;
                            setAttachOpen(false);
                            handleImageUploadClick();
                          }}
                          disabled={inputLocked}
                          className="w-full text-left p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm flex items-center text-zinc-700 dark:text-zinc-300 transition-colors"
                        >
                          <ImagePlus className="w-4 h-4 mr-2.5" /> Upload Image
                        </button>
                      )}
                      {onAudiosChange && (
                        <button
                          type="button"
                          onClick={() => {
                            if (inputLocked) return;
                            setAttachOpen(false);
                            handleAudioUploadClick();
                          }}
                          disabled={inputLocked}
                          className="w-full text-left p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm flex items-center text-zinc-700 dark:text-zinc-300 transition-colors"
                        >
                          <AudioLines className="w-4 h-4 mr-2.5" /> Upload Audio
                        </button>
                      )}
                      {onFilesChange && (
                        <button
                          type="button"
                          onClick={() => {
                            if (inputLocked) return;
                            setAttachOpen(false);
                            handleFileUploadClick();
                          }}
                          disabled={inputLocked}
                          className="w-full text-left p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm flex items-center text-zinc-700 dark:text-zinc-300 transition-colors"
                        >
                          <FileText className="w-4 h-4 mr-2.5" /> Upload File
                        </button>
                      )}
                    </div>
                  )}
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
                </div>
              )}

              {/* Text input */}
              <textarea
                ref={inputRef}
                className="flex-1 resize-none bg-transparent border-0 outline-none text-sm placeholder-zinc-400 dark:placeholder-zinc-500 text-zinc-800 dark:text-zinc-200"
                placeholder={inputLocked ? disabledReason : 'Type your message...'}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={handleKey}
                onPaste={handlePaste}
                rows={1}
                disabled={inputLocked}
                aria-disabled={inputLocked}
                title={inputLocked ? disabledReason : undefined}
              />
            </div>

            {/* ===== CONTROLS BAR ===== */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-3 sm:py-4 gap-2">
              {/* Left side controls - grouped logically */}
              <div className="flex items-center gap-3 sm:gap-4 text-xs scrollbar-hide overflow-x-auto flex-1 min-w-0">
                {/* AI Controls Group */}
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Quality/Reasoning control - always visible */}
                  <Tooltip content="Reasoning effort level">
                    <QualitySlider
                      value={qualityLevel}
                      onChange={onQualityLevelChange}
                      icon={<Gauge className="w-4 h-4" />}
                      ariaLabel="Reasoning Effort"
                      className="flex-shrink-0"
                      model={model.split('::').pop() || model}
                      disabled={controlsDisabled}
                    />
                  </Tooltip>

                  {/* Stream toggle */}
                  <Tooltip content="Stream responses in real-time">
                    <button
                      type="button"
                      onClick={() => {
                        if (inputLocked) return;
                        onShouldStreamChange(!shouldStream);
                      }}
                      disabled={inputLocked}
                      className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 ${
                        shouldStream
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100'
                          : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      <Zap
                        className={`w-3 h-3 sm:w-4 sm:h-4 ${shouldStream ? 'fill-current' : ''}`}
                      />
                      <span className="text-xs sm:text-sm font-medium hidden sm:inline">
                        Stream
                      </span>
                    </button>
                  </Tooltip>
                </div>

                {/* Visual separator */}
                {(supportsThinking || true) && (
                  <div className="hidden md:block w-px h-5 bg-zinc-200 dark:bg-zinc-800" />
                )}

                {/* Tools Group */}
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Custom params selector */}
                  <Tooltip content="Select custom request params" disabled={customParamsOpen}>
                    <div className="relative" ref={customParamsDropdownRef}>
                      <button
                        type="button"
                        aria-label="Custom request params"
                        onClick={() => {
                          if (inputLocked) return;
                          setCustomParamsOpen((v) => !v);
                        }}
                        disabled={inputLocked}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors duration-150"
                      >
                        <Sliders className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors font-medium max-w-[120px] truncate ${
                            localCustomParamsIds.length > 0
                              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                          title={selectedCustomParamsTitle}
                        >
                          {selectedCustomParamsLabel}
                        </span>
                      </button>

                      {customParamsOpen && (
                        <div className="fixed bottom-20 sm:bottom-full left-2 right-2 sm:left-0 sm:right-auto sm:mb-2 w-auto sm:w-[320px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl z-50 overflow-hidden">
                          <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
                            <div>
                              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Custom Params
                              </div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                {customRequestParams.length} presets
                              </div>
                            </div>
                          </div>
                          <div className="max-h-[300px] overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setLocalCustomParamsIds([]);
                                onCustomRequestParamsIdChange?.(null);
                              }}
                              disabled={controlsDisabled}
                              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                                localCustomParamsIds.length === 0
                                  ? 'text-zinc-900 dark:text-zinc-100 font-medium'
                                  : 'text-zinc-600 dark:text-zinc-300'
                              }`}
                            >
                              None
                            </button>
                            {customRequestParams.length === 0 && (
                              <div className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                                No presets configured. Add them in Settings → Advanced.
                              </div>
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
                                  content={
                                    <div className="space-y-1.5 min-w-0 max-w-[300px]">
                                      <div className="font-semibold text-[11px] border-b border-white/10 dark:border-zinc-200/10 pb-1 mb-1">
                                        {preset.label}
                                      </div>
                                      <pre className="text-[10px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                                        {JSON.stringify(preset.params, null, 2)}
                                      </pre>
                                    </div>
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextIds = isActive
                                        ? localCustomParamsIds.filter(
                                            (item) => item !== preset.id && item !== preset.label
                                          )
                                        : Array.from(new Set([...localCustomParamsIds, preset.id]));
                                      setLocalCustomParamsIds(nextIds);
                                      onCustomRequestParamsIdChange?.(
                                        nextIds.length > 0 ? nextIds : null
                                      );
                                    }}
                                    disabled={controlsDisabled}
                                    className={`w-full flex items-start justify-between px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                                      isActive ? 'bg-zinc-50/50 dark:bg-zinc-800/50' : ''
                                    }`}
                                  >
                                    <div className="flex-1 min-w-0 pr-2">
                                      <div
                                        className={`text-sm ${
                                          isActive
                                            ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                                            : 'text-zinc-700 dark:text-zinc-300'
                                        }`}
                                      >
                                        {preset.label}
                                      </div>
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate mt-0.5">
                                        {JSON.stringify(preset.params)}
                                      </div>
                                    </div>
                                    {isActive && (
                                      <div className="flex-shrink-0 pt-0.5">
                                        <Check className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                                      </div>
                                    )}
                                  </button>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </Tooltip>

                  {/* Tools selector */}
                  <Tooltip content="Select tools to enable" disabled={toolsOpen}>
                    <div className="relative" ref={toolsDropdownRef}>
                      <button
                        type="button"
                        aria-label="Tools"
                        onClick={() => {
                          if (inputLocked) return;
                          setToolsOpen((v) => !v);
                        }}
                        disabled={inputLocked}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors duration-150"
                      >
                        <Wrench className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full transition-colors font-medium ${
                            localSelected.length > 0
                              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {localSelected.length || 'None'}
                        </span>
                      </button>

                      {/* Tools dropdown */}
                      {toolsOpen && (
                        <div className="fixed bottom-20 sm:bottom-full left-2 right-2 sm:left-0 sm:right-auto sm:mb-2 w-auto sm:w-[420px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl z-50 overflow-hidden max-h-[60vh] sm:max-h-[500px]">
                          {/* Dropdown header */}
                          <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Tools
                              </div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                {availableTools.length} available
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Toggle
                                ariaLabel="Enable tools"
                                checked={localSelected.length > 0}
                                disabled={controlsDisabled}
                                onChange={(v: boolean) => {
                                  if (inputLocked) return;
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
                          </div>

                          {/* Search and bulk actions */}
                          <div className="sticky top-0 bg-white dark:bg-zinc-900 z-20 px-3 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-2 mb-3">
                              <input
                                ref={searchInputRef}
                                type="text"
                                value={toolFilter}
                                onChange={(e) => setToolFilter(e.target.value)}
                                disabled={controlsDisabled}
                                placeholder="Search tools..."
                                className="flex-1 text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700"
                              />
                              <div className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                {filteredTools.length} visible
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
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
                                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
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
                                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                              >
                                Select visible
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (inputLocked) return;
                                  setLocalSelected([]);
                                  onEnabledToolsChange?.([]);
                                  onUseToolsChange?.(false);
                                }}
                                disabled={controlsDisabled}
                                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (inputLocked) return;
                                  const visibleIds = new Set(filteredTools.map((t) => t.name));
                                  const next = localSelected.filter((x) => !visibleIds.has(x));
                                  setLocalSelected(next);
                                  onEnabledToolsChange?.(next);
                                  onUseToolsChange?.(next.length > 0);
                                }}
                                disabled={controlsDisabled}
                                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
                              >
                                Clear visible
                              </button>
                            </div>
                          </div>

                          {/* Tools list */}
                          <div className="max-h-80 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent">
                            {availableTools.length === 0 && (
                              <div className="text-sm text-zinc-500 dark:text-zinc-400 p-4 text-center">
                                No tools available
                              </div>
                            )}

                            <div className="p-3 space-y-1.5">
                              {filteredTools.map((t) => {
                                const id = t.name;
                                const checked = localSelected.includes(id);
                                const keyStatus = toolApiKeyStatus[id];
                                const isDisabled =
                                  keyStatus?.requiresApiKey && !keyStatus?.hasApiKey;
                                const disabledTooltip = isDisabled
                                  ? `This tool requires ${
                                      keyStatus?.missingKeyLabel || 'an API key'
                                    }. Please configure it in Settings.`
                                  : undefined;

                                const toolButton = (
                                  <button
                                    key={id}
                                    type="button"
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
                                    className={`w-full text-left p-2.5 rounded-lg transition-all duration-150 flex items-start gap-3 group ${
                                      isDisabled
                                        ? 'opacity-50 cursor-not-allowed bg-zinc-50 dark:bg-zinc-800/50'
                                        : checked
                                          ? 'bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700'
                                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                    }`}
                                  >
                                    <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-400 group-hover:border-zinc-300 dark:group-hover:border-zinc-600 transition-colors">
                                      {t.name?.charAt(0)?.toUpperCase() || 'T'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-0.5">
                                        {t.name}
                                      </div>
                                      {t.description &&
                                        (isDisabled ? (
                                          <div className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                            {t.description}
                                          </div>
                                        ) : (
                                          <Tooltip content={t.description}>
                                            <div className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                              {t.description}
                                            </div>
                                          </Tooltip>
                                        ))}
                                    </div>
                                    <div className="flex-shrink-0 flex items-center pt-0.5">
                                      <input
                                        type="checkbox"
                                        className="w-4 h-4 cursor-pointer accent-zinc-600 dark:accent-zinc-500 disabled:cursor-not-allowed"
                                        checked={checked}
                                        disabled={isDisabled}
                                        readOnly
                                      />
                                    </div>
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
                        </div>
                      )}
                    </div>
                  </Tooltip>
                </div>
              </div>

              {/* ===== SEND BUTTON ===== */}
              <button
                type="button"
                onClick={() => {
                  if (pending.streaming) {
                    onStop();
                  } else if (!inputLocked) {
                    onSend();
                  }
                }}
                disabled={(!canSend || inputLocked) && !pending.streaming}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md disabled:hover:shadow-none flex-shrink-0"
              >
                {pending.streaming ? (
                  <>
                    <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
                    <span className="hidden sm:inline">Stop</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Send</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </ImageUploadZone>
  );
});
