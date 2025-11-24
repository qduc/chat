import { useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  Send,
  Loader2,
  Gauge,
  Wrench,
  Zap,
  ImagePlus,
  FileText,
  Globe,
  Paperclip,
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
} from '../lib';
import Toggle from './ui/Toggle';
import QualitySlider from './ui/QualitySlider';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
import { FilePreview } from './ui/FilePreview';
import Tooltip from './ui/Tooltip';
import type { QualityLevel } from './ui/QualitySlider';

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
  model: string;
  qualityLevel: QualityLevel;
  onQualityLevelChange: (level: QualityLevel) => void;
  modelCapabilities?: Record<string, any>; // Model capabilities from provider
  images?: ImageAttachment[];
  onImagesChange?: (images: ImageAttachment[]) => void;
  files?: FileAttachment[];
  onFilesChange?: (files: FileAttachment[]) => void;
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
    onShouldStreamChange,
    model,
    qualityLevel,
    onQualityLevelChange,
    modelCapabilities = {},
    images = [],
    onImagesChange,
    files = [],
    onFilesChange,
  },
  ref
) {
  // ===== REFS =====
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsDropdownRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
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
  const [imageUploadProgress, setImageUploadProgress] = useState<ImageUploadProgress[]>([]);
  const [fileUploadProgress, setFileUploadProgress] = useState<FileUploadProgress[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);

  // ===== COMPUTED VALUES =====
  // Check if both search tools are enabled
  const searchEnabled = useMemo(() => {
    return localSelected.includes('web_search') && localSelected.includes('web_search_exa');
  }, [localSelected]);

  // Check if model supports thinking/reasoning
  const supportsThinking = useMemo(() => {
    return supportsReasoningControls(model, modelCapabilities);
  }, [model, modelCapabilities]);

  // Check if we can send (have text or images)
  const canSend = input.trim().length > 0 || images.length > 0;

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
      const aDisabled = isToolDisabled(a.name);
      const bDisabled = isToolDisabled(b.name);
      if (aDisabled && !bDisabled) return 1;
      if (!aDisabled && bDisabled) return -1;
      // both same disabled status
      if (!aDisabled) {
        const aSelected = localSelected.includes(a.name);
        const bSelected = localSelected.includes(b.name);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
      }
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
      if (pending.streaming) onStop();
      else onSend();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    imageInputRef.current?.click();
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imageFiles = Array.from(e.target.files || []);
    if (imageFiles.length > 0) {
      handleImageFiles(imageFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // File handling
  const handleFileFiles = async (textFiles: File[]) => {
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
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const textFiles = Array.from(e.target.files || []);
    if (textFiles.length > 0) {
      handleFileFiles(textFiles);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  // Tools handling
  const handleSearchToggle = (enabled: boolean) => {
    const searchTools = ['web_search', 'web_search_exa', 'web_search_searxng', 'web_fetch'];
    let next: string[];

    if (enabled) {
      // Add both search tools if not already present
      next = [...new Set([...localSelected, ...searchTools])];
    } else {
      // Remove both search tools
      next = localSelected.filter((t) => !searchTools.includes(t));
    }

    setLocalSelected(next);
    onEnabledToolsChange?.(next);
    onUseToolsChange?.(next.length > 0);
  };

  // ===== RENDER =====
  return (
    <ImageUploadZone
      onFiles={handleImageFiles}
      disabled={pending.streaming}
      fullPage={true}
      clickToUpload={false} // Avoid overlay input intercepting hover events (tooltips)
    >
      <form
        className=""
        onSubmit={(e) => {
          e.preventDefault();
          if (pending.streaming) onStop();
          else onSend();
        }}
      >
        <div>
          <div className="relative rounded-xl bg-white dark:bg-neutral-950 border border-slate-200/80 dark:border-neutral-800/80 shadow-sm">
            {/* ===== IMAGE PREVIEWS ===== */}
            {images.length > 0 && (
              <div className="p-4 pb-2 border-b border-slate-200 dark:border-neutral-700">
                <ImagePreview
                  images={images}
                  uploadProgress={imageUploadProgress}
                  onRemove={onImagesChange ? handleRemoveImage : undefined}
                />
              </div>
            )}

            {/* ===== FILE PREVIEWS ===== */}
            {files.length > 0 && (
              <div className="p-4 pb-2 border-b border-slate-200 dark:border-neutral-700">
                <FilePreview
                  files={files}
                  uploadProgress={fileUploadProgress}
                  onRemove={onFilesChange ? handleRemoveFile : undefined}
                />
              </div>
            )}

            {/* ===== TEXT INPUT WITH IMAGE/FILE UPLOAD ===== */}
            <div className="flex items-start gap-3 p-3 sm:p-4">
              {/* Attach button */}
              {(onImagesChange || onFilesChange) && (
                <div className="relative" ref={attachDropdownRef}>
                  {attachOpen ? (
                    <button
                      type="button"
                      onClick={() => setAttachOpen(!attachOpen)}
                      disabled={pending.streaming}
                      className={`flex-shrink-0 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                        images.length > 0 || files.length > 0
                          ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                      aria-label="Attach Files"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                  ) : (
                    <Tooltip content="Attach files">
                      <button
                        type="button"
                        onClick={() => setAttachOpen(!attachOpen)}
                        disabled={pending.streaming}
                        className={`flex-shrink-0 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                          images.length > 0 || files.length > 0
                            ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                        aria-label="Attach Files"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}
                  {attachOpen && (
                    <div className="absolute bottom-full mb-2 left-0 w-48 sm:w-56 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 shadow-xl rounded-lg p-2 z-50">
                      {onImagesChange && (
                        <button
                          type="button"
                          onClick={() => {
                            setAttachOpen(false);
                            handleImageUploadClick();
                          }}
                          className="w-full text-left p-2 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-800 text-sm flex items-center"
                        >
                          <ImagePlus className="w-4 h-4 mr-2" /> Upload Image
                        </button>
                      )}
                      {onFilesChange && (
                        <button
                          type="button"
                          onClick={() => {
                            setAttachOpen(false);
                            handleFileUploadClick();
                          }}
                          className="w-full text-left p-2 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-800 text-sm flex items-center"
                        >
                          <FileText className="w-4 h-4 mr-2" /> Upload File
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
                      accept=".js,.jsx,.ts,.tsx,.py,.rb,.java,.cpp,.go,.html,.css,.scss,.json,.xml,.yaml,.yml,.md,.txt,.csv,.log,.sh,.bash,.sql,.graphql"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                  )}
                </div>
              )}

              {/* Text input */}
              <textarea
                ref={inputRef}
                className="flex-1 resize-none bg-transparent border-0 outline-none text-sm placeholder-slate-500 dark:placeholder-slate-400 text-slate-800 dark:text-slate-200"
                placeholder="Type your message..."
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={handleKey}
                onPaste={handlePaste}
                rows={1}
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
                    />
                  </Tooltip>

                  {/* Stream toggle */}
                  <Tooltip content="Stream responses in real-time">
                    <button
                      type="button"
                      onClick={() => onShouldStreamChange(!shouldStream)}
                      className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 ${
                        shouldStream
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                          : 'border-transparent hover:bg-slate-100 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span className="text-xs sm:text-sm font-medium hidden sm:inline">
                        Stream
                      </span>
                    </button>
                  </Tooltip>
                </div>

                {/* Visual separator */}
                {(supportsThinking || true) && (
                  <div className="hidden md:block w-px h-6 bg-slate-200 dark:bg-neutral-700" />
                )}

                {/* Tools Group */}
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Search toggle */}
                  <Tooltip content="Enable web search (Tavily + Exa)">
                    <button
                      type="button"
                      onClick={() => handleSearchToggle(!searchEnabled)}
                      className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 ${
                        searchEnabled
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                          : 'border-transparent hover:bg-slate-100 dark:hover:bg-neutral-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Globe className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span className="text-xs sm:text-sm font-medium hidden sm:inline">
                        Search
                      </span>
                    </button>
                  </Tooltip>

                  {/* Tools selector */}
                  <Tooltip content="Select tools to enable">
                    <div className="relative" ref={toolsDropdownRef}>
                      <button
                        type="button"
                        aria-label="Tools"
                        onClick={() => setToolsOpen((v) => !v)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors duration-150"
                      >
                        <Wrench className="w-4 h-4" />
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                            localSelected.length > 0
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {localSelected.length || 'None'}
                        </span>
                      </button>

                      {/* Tools dropdown */}
                      {toolsOpen && (
                        <div className="fixed bottom-20 sm:bottom-full left-2 right-2 sm:left-0 sm:right-auto sm:mb-2 w-auto sm:w-[420px] bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 shadow-xl rounded-lg z-50 overflow-hidden max-h-[60vh] sm:max-h-[500px]">
                          {/* Dropdown header */}
                          <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-neutral-800">
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                Tools
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {availableTools.length} available
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Toggle
                                ariaLabel="Enable tools"
                                checked={localSelected.length > 0}
                                onChange={(v: boolean) => {
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
                          <div className="sticky top-0 bg-white dark:bg-neutral-900 z-20 px-3 pt-3 pb-2 border-b border-slate-100 dark:border-neutral-800">
                            <div className="flex items-center gap-2 mb-3">
                              <input
                                ref={searchInputRef}
                                type="text"
                                value={toolFilter}
                                onChange={(e) => setToolFilter(e.target.value)}
                                placeholder="Search tools..."
                                className="flex-1 text-sm px-3 py-1.5 border border-slate-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                              />
                              <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {filteredTools.length} visible
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => {
                                  const all = availableTools
                                    .filter((t) => !isToolDisabled(t.name))
                                    .map((t) => t.name);
                                  setLocalSelected(all);
                                  onEnabledToolsChange?.(all);
                                  onUseToolsChange?.(all.length > 0);
                                }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-colors"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const visibleIds = filteredTools
                                    .filter((t) => !isToolDisabled(t.name))
                                    .map((t) => t.name);
                                  const next = [...new Set([...localSelected, ...visibleIds])];
                                  setLocalSelected(next);
                                  onEnabledToolsChange?.(next);
                                  onUseToolsChange?.(next.length > 0);
                                }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-colors"
                              >
                                Select visible
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setLocalSelected([]);
                                  onEnabledToolsChange?.([]);
                                  onUseToolsChange?.(false);
                                }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 hover:bg-slate-50 dark:hover:bg-neutral-800 text-slate-700 dark:text-slate-300 transition-colors"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const visibleIds = new Set(filteredTools.map((t) => t.name));
                                  const next = localSelected.filter((x) => !visibleIds.has(x));
                                  setLocalSelected(next);
                                  onEnabledToolsChange?.(next);
                                  onUseToolsChange?.(next.length > 0);
                                }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 hover:bg-slate-50 dark:hover:bg-neutral-800 text-slate-700 dark:text-slate-300 transition-colors"
                              >
                                Clear visible
                              </button>
                            </div>
                          </div>

                          {/* Tools list */}
                          <div className="max-h-80 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent hover:scrollbar-thumb-slate-400 dark:hover:scrollbar-thumb-neutral-600">
                            {availableTools.length === 0 && (
                              <div className="text-sm text-slate-500 dark:text-slate-400 p-4 text-center">
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
                                        ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-neutral-800/50'
                                        : checked
                                          ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800'
                                          : 'hover:bg-slate-50 dark:hover:bg-neutral-800'
                                    }`}
                                  >
                                    <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-slate-200 dark:bg-neutral-700 text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:bg-slate-300 dark:group-hover:bg-neutral-600 transition-colors">
                                      {t.name?.charAt(0)?.toUpperCase() || 'T'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-0.5">
                                        {t.name}
                                      </div>
                                      {t.description &&
                                        (isDisabled ? (
                                          <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                            {t.description}
                                          </div>
                                        ) : (
                                          <Tooltip content={t.description}>
                                            <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                              {t.description}
                                            </div>
                                          </Tooltip>
                                        ))}
                                    </div>
                                    <div className="flex-shrink-0 flex items-center pt-0.5">
                                      <input
                                        type="checkbox"
                                        className="w-4 h-4 cursor-pointer accent-blue-600 dark:accent-blue-500 disabled:cursor-not-allowed"
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

                          {/* Dropdown footer */}
                          <div className="flex justify-end p-3 border-t border-slate-100 dark:border-neutral-800 bg-slate-50/50 dark:bg-neutral-800/50">
                            <button
                              type="button"
                              onClick={() => setToolsOpen(false)}
                              className="text-sm px-4 py-2 rounded-lg bg-slate-800 dark:bg-slate-600 hover:bg-slate-700 dark:hover:bg-slate-500 text-white cursor-pointer transition-colors duration-150 font-medium"
                            >
                              Done
                            </button>
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
                  } else {
                    onSend();
                  }
                }}
                disabled={!canSend && !pending.streaming}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg disabled:hover:shadow-md transform hover:scale-[1.02] disabled:hover:scale-100 flex-shrink-0"
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
