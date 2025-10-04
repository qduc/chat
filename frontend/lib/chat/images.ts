/* eslint-disable @typescript-eslint/no-explicit-any */

import { httpClient } from '../http/client';
import type { ImageAttachment, ImageConfig, ImageValidationResult, ImageUploadProgress } from './types';

import { resolveApiBase } from '../config/apiBase';

export class ImagesClient {
  constructor(private apiBase: string = resolveApiBase()) {}

  /**
   * Get image upload configuration from backend
   */
  async getConfig(): Promise<ImageConfig> {
    const response = await httpClient.get(`${this.apiBase}/v1/images/config`);
    return response.data;
  }

  /**
   * Validate image files before upload
   */
  async validateImages(files: File[], config?: ImageConfig): Promise<ImageValidationResult> {
    const actualConfig = config || await this.getConfig();
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file count
    if (files.length > actualConfig.maxImagesPerMessage) {
      errors.push(`Maximum ${actualConfig.maxImagesPerMessage} images allowed per message`);
    }

    for (const file of files) {
      // Check file size
      if (file.size > actualConfig.maxFileSize) {
        const maxSizeMB = actualConfig.maxFileSize / (1024 * 1024);
        errors.push(`${file.name}: File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds ${maxSizeMB}MB limit`);
      }

      // Check file type
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !actualConfig.allowedFormats.includes(ext)) {
        errors.push(`${file.name}: Invalid file type. Allowed: ${actualConfig.allowedFormats.join(', ')}`);
      }

      // Check if it's actually an image
      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: Not a valid image file`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Upload image files
   */
  async uploadImages(
    files: File[],
    onProgress?: (progress: ImageUploadProgress[]) => void
  ): Promise<ImageAttachment[]> {
    // Validate files first
    const validation = await this.validateImages(files);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

      const toAbsoluteUrl = (value?: string | null) => {
        if (!value) return undefined;
        if (/^https?:\/\//i.test(value)) {
          return value;
        }
        const normalized = value.startsWith('/') ? value : `/${value}`;
        return `${this.apiBase}${normalized}`;
      };

    // Create progress tracking
    const progressData: ImageUploadProgress[] = files.map((file, index) => ({
      imageId: `temp-${index}`,
      state: 'pending',
      progress: 0,
    }));

    if (onProgress) {
      onProgress(progressData);
    }

    try {
      // Update progress to uploading
      progressData.forEach(p => {
        p.state = 'uploading';
        p.progress = 0;
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      const response = await httpClient.post(`${this.apiBase}/v1/images/upload`, formData, {
        // Note: Don't set Content-Type header for FormData - browser will set it with boundary
        // Note: For now we don't have upload progress from httpClient
        // In a production app, you'd want to implement this with XMLHttpRequest
      });

      // Update progress to ready
      const uploadedImages = response.data.images;
      const result: ImageAttachment[] = uploadedImages.map((img: any, index: number) => {
        progressData[index].state = 'ready';
        progressData[index].progress = 100;
        progressData[index].imageId = img.id;

        return {
          id: img.id,
          file: files[index],
          url: toAbsoluteUrl(img.url) ?? `${this.apiBase}/v1/images/${img.id}`,
          downloadUrl: toAbsoluteUrl(img.downloadUrl),
          accessToken: typeof img.accessToken === 'string' ? img.accessToken : undefined,
          expiresAt: typeof img.expiresAt === 'string' ? img.expiresAt : undefined,
          expiresIn: typeof img.expiresIn === 'number' ? img.expiresIn : undefined,
          name: img.originalFilename || img.filename,
          size: img.size,
          type: img.type,
          alt: img.alt,
        };
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      return result;

    } catch (error: any) {
      // Update progress to error
      progressData.forEach(p => {
        p.state = 'error';
        p.error = error.message || 'Upload failed';
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      throw error;
    }
  }

  /**
   * Create a blob URL for local image preview
   */
  createPreviewUrl(file: File): string {
    return URL.createObjectURL(file);
  }

  /**
   * Revoke a blob URL to free memory
   */
  revokePreviewUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Convert ImageAttachment to ImageContent for API
   */
  attachmentToImageContent(attachment: ImageAttachment, detail: 'auto' | 'low' | 'high' = 'auto') {
    // Use base URL without tokens for storage - signed URLs will be generated on demand
    const rawUrl = attachment.url;
    return {
      type: 'image_url' as const,
      image_url: {
        url: rawUrl,
        detail,
      },
    };
  }
}

// Export a default instance
export const imagesClient = new ImagesClient();
