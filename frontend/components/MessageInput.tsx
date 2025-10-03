import { useEffect, useRef, useState, useMemo } from 'react';
import { Send, Loader2, Gauge, Wrench, Zap, ImagePlus } from 'lucide-react';
import type { PendingState } from '../hooks/useChatState';
import type { ImageAttachment, ImageUploadProgress } from '../lib/chat/types';
import { imagesClient } from '../lib/chat/images';
import Toggle from './ui/Toggle';
import QualitySlider from './ui/QualitySlider';
import { ImagePreview, ImageUploadZone } from './ui/ImagePreview';
import type { QualityLevel } from './ui/QualitySlider';
import { supportsReasoningControls } from '../lib/chat/modelCapabilities';

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
  useTools,
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
    import('../lib/chat').then(mod => {
      const ToolsClient = (mod as any).ToolsClient;
      if (!ToolsClient) return;
      const client = new ToolsClient();
      client.getToolSpecs().then((res: any) => {
        if (!mounted) return;
        const tools = (res.tools || []).map((t: any) => ({ name: t.function?.name || t.name, description: t.function?.description || t.description }));
        setAvailableTools(tools);
      }).catch(() => setAvailableTools([]));
    }).catch(() => setAvailableTools([]));
    return () => { mounted = false; };
  }, []);

  // Handle image file selection
  const handleImageFiles = async (files: File[]) => {
    if (!onImagesChange) return;

    try {
      const uploadedImages = await imagesClient.uploadImages(files, setUploadProgress);
      onImagesChange([...images, ...uploadedImages]);
    } catch (error) {
      console.error('Image upload failed:', error);
      // TODO: Show error toast/notification
    }
  };

  // Handle image removal
  const handleRemoveImage = (imageId: string) => {
    if (!onImagesChange) return;

    const imageToRemove = images.find(img => img.id === imageId);
    if (imageToRemove) {
      // Revoke blob URL to free memory
      imagesClient.revokePreviewUrl(imageToRemove.url);
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
    <ImageUploadZone onFiles={handleImageFiles} disabled={pending.streaming}>
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
                      <div className="absolute bottom-full mb-2 right-0 w-72 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 shadow-lg rounded-lg p-3 z-50">
                        <div className="text-sm font-medium mb-2">Tools</div>
                        <div className="max-h-40 overflow-auto space-y-2">
                          {availableTools.length === 0 && (
                            <div className="text-xs text-slate-500">No tools available</div>
                          )}
                          {availableTools.map(t => {
                            const id = t.name;
                            const checked = localSelected.includes(id);
                            return (
                              <label key={id} className="flex items-start gap-2 cursor-pointer p-1 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-800 transition-colors duration-150">
                                <input
                                  type="checkbox"
                                  className="mt-1 cursor-pointer"
                                  checked={checked}
                                  onChange={e => {
                                    const next = e.target.checked ? [...localSelected, id] : localSelected.filter(x => x !== id);
                                    setLocalSelected(next);
                                    onEnabledToolsChange?.(next);
                                    onUseToolsChange?.(next.length > 0);
                                  }}
                                />
                                <div className="text-xs">
                                  <div className="font-medium text-slate-800 dark:text-slate-200">{t.name}</div>
                                  {t.description && <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.description}</div>}
                                </div>
                              </label>
                            );
                          })}
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
