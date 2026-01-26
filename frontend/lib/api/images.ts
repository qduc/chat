/**
 * Images API module
 */

import { httpClient } from '../http';
import { toAbsoluteUrl, resolveApiBase } from '../urlUtils';
import type {
  ImageAttachment,
  ImageConfig,
  ImageValidationResult,
  ImageUploadProgress,
} from '../types';

export const images = {
  async getConfig(): Promise<ImageConfig> {
    const response = await httpClient.get('/v1/images/config');
    return response.data;
  },

  async validateImages(files: File[], config?: ImageConfig): Promise<ImageValidationResult> {
    const actualConfig = config || (await this.getConfig());
    const errors: string[] = [];
    const warnings: string[] = [];

    if (files.length > actualConfig.maxImagesPerMessage) {
      errors.push(`Maximum ${actualConfig.maxImagesPerMessage} images allowed per message`);
    }

    for (const file of files) {
      if (file.size > actualConfig.maxFileSize) {
        const maxSizeMB = actualConfig.maxFileSize / (1024 * 1024);
        errors.push(
          `${file.name}: File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds ${maxSizeMB}MB limit`
        );
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !actualConfig.allowedFormats.includes(ext)) {
        errors.push(
          `${file.name}: Invalid file type. Allowed: ${actualConfig.allowedFormats.join(', ')}`
        );
      }

      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: Not a valid image file`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async uploadImages(
    files: File[],
    onProgress?: (progress: ImageUploadProgress[]) => void
  ): Promise<ImageAttachment[]> {
    const validation = await this.validateImages(files);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('images', file);
    });

    const apiBase = resolveApiBase();

    const progressData: ImageUploadProgress[] = files.map((file, index) => ({
      imageId: `temp-${index}`,
      state: 'pending' as const,
      progress: 0,
    }));

    if (onProgress) {
      onProgress(progressData);
    }

    try {
      progressData.forEach((p) => {
        p.state = 'uploading';
        p.progress = 0;
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      const response = await httpClient.post('/v1/images/upload', formData);

      const uploadedImages = response.data.images;
      const result: ImageAttachment[] = uploadedImages.map((img: any, index: number) => {
        progressData[index].state = 'ready';
        progressData[index].progress = 100;
        progressData[index].imageId = img.id;

        return {
          id: img.id,
          file: files[index],
          url: toAbsoluteUrl(img.url, apiBase) ?? `${apiBase}/v1/images/${img.id}`,
          downloadUrl: toAbsoluteUrl(img.downloadUrl, apiBase),
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
      progressData.forEach((p) => {
        p.state = 'error';
        p.error = error.message || 'Upload failed';
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      throw error;
    }
  },

  createPreviewUrl(file: File): string {
    return URL.createObjectURL(file);
  },

  revokePreviewUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  },

  attachmentToImageContent(attachment: ImageAttachment, detail: 'auto' | 'low' | 'high' = 'auto') {
    const rawUrl = attachment.url;
    return {
      type: 'image_url' as const,
      image_url: {
        url: rawUrl,
        detail,
      },
    };
  },
};
