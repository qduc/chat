import { useEffect, useRef, useState, useMemo } from 'react';
import { Send, Loader2, Gauge, Wrench, Zap, ImagePlus } from 'lucide-react';
import type { PendingState } from '@/hooks/useChat';
import { images as imageUtils, supportsReasoningControls, type ImageAttachment, type ImageUploadProgress } from '../lib';
import Toggle from './ui/Toggle';
import QualitySlider from './ui/QualitySlider';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
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
}

export function MessageInput({
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
}: MessageInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsDropdownRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [availableTools, setAvailableTools] = useState<{ name: string; description?: string }[]>([]);
  const [toolFilter, setToolFilter] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(enabledTools);
  const [uploadProgress, setUploadProgress] = useState<ImageUploadProgress[]>([]);

  // Check if model supports thinking/reasoning
  const supportsThinking = useMemo(() => {
    return supportsReasoningControls(model, modelCapabilities);
  }, [model, modelCapabilities]);

  // Auto-grow textarea up to ~200px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(200, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);

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

  // Load tool specs for the selector UI
  useEffect(() => {
    let mounted = true;
    import('../lib/api').then(mod => {
      const apiTools = (mod as any).tools;
      if (!apiTools || typeof apiTools.getToolSpecs !== 'function') {
        if (mounted) setAvailableTools([]);
        return;
      }

      apiTools.getToolSpecs()
        .then((res: any) => {
          if (!mounted) return;
          const specs = Array.isArray(res?.tools) ? res.tools : [];
          const names = Array.isArray(res?.available_tools) ? res.available_tools : [];

          const tools = specs.length > 0
            ? specs.map((t: any) => ({ name: t.function?.name || t.name, description: t.function?.description || t.description }))
            : names.map((n: string) => ({ name: n, description: undefined }));

          setAvailableTools(tools);
        })
        .catch(() => {
          if (mounted) setAvailableTools([]);
        });
    }).catch(() => { if (mounted) setAvailableTools([]); });

    return () => { mounted = false; };
  }, []);

  // Handle image file selection
  const handleImageFiles = async (files: File[]) => {
    if (!onImagesChange || !images) return;

    try {
      const uploadedImages = await imageUtils.uploadImages(files, setUploadProgress);
      onImagesChange([...images, ...uploadedImages]);
    } catch (error) {
      console.error('Image upload failed:', error);
      // TODO: Show error toast/notification
    }
  };

  // Handle image removal
  const handleRemoveImage = (imageId: string) => {
    if (!onImagesChange || !images) return;

    const imageToRemove = images.find(img => img.id === imageId);
    if (imageToRemove) {
      // Revoke blob URL to free memory
      imageUtils.revokePreviewUrl(imageToRemove.url);
      onImagesChange(images.filter(img => img.id !== imageId));
    }
  };

  // Handle image upload button click
  const handleImageUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleImageFiles(files);
    }
    // Reset input value so same file can be selected again
    e.target.value = '';
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onImagesChange) return;

    const items = Array.from(event.clipboardData?.items || []);
    const files: File[] = [];

    items.forEach(item => {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) {
          files.push(file);
        }
      }
    });

    if (files.length === 0) {
      const fileList = Array.from(event.clipboardData?.files || []);
      fileList.forEach(file => {
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


  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (pending.streaming) onStop();
      else onSend();
    }
  };

  // Check if we can send (have text or images)
  const canSend = input.trim().length > 0 || images.length > 0;

  return (
  <ImageUploadZone onFiles={handleImageFiles} disabled={pending.streaming} fullPage={true}>
      <form
        className=""
        onSubmit={e => { e.preventDefault(); if (pending.streaming) onStop(); else onSend(); }}
      >
        <div className="px-2">
          <div className="relative rounded-2xl bg-white/95 dark:bg-neutral-900/95 border border-slate-200 dark:border-neutral-700 shadow-xl transition-shadow duration-200">

            {/* Image Previews */}
            {images.length > 0 && (
              <div className="p-4 pb-2 border-b border-slate-200 dark:border-neutral-700">
                <ImagePreview
                  images={images}
                  uploadProgress={uploadProgress}
                  onRemove={onImagesChange ? handleRemoveImage : undefined}
                />
              </div>
            )}

            <textarea
              ref={inputRef}
              className="w-full resize-none bg-transparent border-0 outline-none p-4 text-sm placeholder-slate-500 dark:placeholder-slate-400 text-slate-800 dark:text-slate-200"
              placeholder="Type your message..."
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              rows={1}
            />
            <div className="flex items-center justify-between px-4 pb-4">
              <div className="flex items-center gap-4 text-xs scrollbar-hide">
                <div className="flex items-center">
                  {/* model selector moved to header */}
                </div>

                {supportsThinking && (
                  <div className="flex items-center">
                    <QualitySlider
                      value={qualityLevel}
                      onChange={onQualityLevelChange}
                      icon={<Gauge className="w-4 h-4" />}
                      ariaLabel="Response Quality"
                      className="flex-shrink-0"
                    />
                  </div>
                )}

                <div className="flex items-center">
                  <div className="relative" ref={toolsDropdownRef}>
                    <button
                      type="button"
                      aria-label="Tools"
                      onClick={() => setToolsOpen(v => !v)}
                      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors duration-150"
                    >
                      <Wrench className="w-4 h-4" />
                      <span className="text-xs text-slate-600 dark:text-slate-300">{localSelected.length ? `${localSelected.length}` : 'Off'}</span>
                    </button>

                      {toolsOpen && (
                        <div className="absolute bottom-full mb-2 right-0 w-80 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 shadow-xl rounded-lg p-3 z-50">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-semibold">Tools</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{availableTools.length} available</div>
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
                                    const all = availableTools.map(t => t.name);
                                    setLocalSelected(all);
                                    onEnabledToolsChange?.(all);
                                    onUseToolsChange?.(all.length > 0);
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mb-3">
                            <input
                              type="text"
                              value={toolFilter}
                              onChange={e => setToolFilter(e.target.value)}
                              placeholder="Search tools..."
                              className="flex-1 text-xs px-2 py-1 border border-slate-200 dark:border-neutral-800 rounded-md bg-slate-50 dark:bg-neutral-800 text-slate-800 dark:text-slate-200"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const all = availableTools.map(t => t.name);
                                setLocalSelected(all);
                                onEnabledToolsChange?.(all);
                                onUseToolsChange?.(all.length > 0);
                              }}
                              className="text-xs px-2 py-1 rounded-md bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700"
                            >Select all</button>
                            <button
                              type="button"
                              onClick={() => {
                                setLocalSelected([]);
                                onEnabledToolsChange?.([]);
                                onUseToolsChange?.(false);
                              }}
                              className="text-xs px-2 py-1 rounded-md bg-transparent border border-slate-100 dark:border-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800"
                            >Clear</button>
                          </div>

                          <div className="max-h-48 overflow-auto">
                            {availableTools.length === 0 && (
                              <div className="text-xs text-slate-500">No tools available</div>
                            )}

                            <div className="grid grid-cols-1 gap-2">
                              {availableTools
                                .filter(t => t.name.toLowerCase().includes(toolFilter.toLowerCase()) || (t.description || '').toLowerCase().includes(toolFilter.toLowerCase()))
                                .map(t => {
                                  const id = t.name;
                                  const checked = localSelected.includes(id);
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      onClick={() => {
                                        const next = checked ? localSelected.filter(x => x !== id) : [...localSelected, id];
                                        setLocalSelected(next);
                                        onEnabledToolsChange?.(next);
                                        onUseToolsChange?.(next.length > 0);
                                      }}
                                      className={`w-full text-left p-2 rounded-md transition-colors duration-150 flex items-center justify-between ${checked ? 'bg-slate-100 dark:bg-neutral-800 ring-1 ring-slate-200 dark:ring-neutral-700' : 'hover:bg-slate-50 dark:hover:bg-neutral-800'}`}
                                    >
                                      <div>
                                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{t.name}</div>
                                        {t.description && <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.description}</div>}
                                      </div>
                                      <div className="flex items-center">
                                        <input
                                          type="checkbox"
                                          className="cursor-pointer"
                                          checked={checked}
                                          readOnly
                                        />
                                      </div>
                                    </button>
                                  );
                                })}
                            </div>
                          </div>

                          <div className="flex justify-end mt-3">
                            <button
                              type="button"
                              onClick={() => setToolsOpen(false)}
                              className="text-xs px-3 py-1 rounded-md bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 cursor-pointer transition-colors duration-150"
                            >Done</button>
                          </div>
                        </div>
                      )}
                  </div>
                </div>

                {/* Image Upload Button */}
                {onImagesChange && (
                  <div className="flex items-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                    <button
                      type="button"
                      onClick={handleImageUploadClick}
                      disabled={pending.streaming}
                      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Add Images"
                    >
                      <ImagePlus className="w-4 h-4" />
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        {images.length > 0 ? images.length : 'Images'}
                      </span>
                    </button>
                  </div>
                )}

                <div className="flex items-center">
                  <Toggle
                    ariaLabel="Stream"
                    icon={<Zap className="w-4 h-4" />}
                    checked={shouldStream}
                    onChange={onShouldStreamChange}
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
                  disabled={!canSend && !pending.streaming}
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
    </ImageUploadZone>
  );
}
