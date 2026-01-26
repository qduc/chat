/**
 * Files API module
 */

import { httpClient } from '../http';
import { toAbsoluteUrl, resolveApiBase } from '../urlUtils';
import type {
  FileAttachment,
  FileConfig,
  FileValidationResult,
  FileUploadProgress,
} from '../types';

export const files = {
  async getConfig(): Promise<FileConfig> {
    const response = await httpClient.get('/v1/files/config');
    return response.data;
  },

  async validateFiles(files: File[], config?: FileConfig): Promise<FileValidationResult> {
    const actualConfig = config || (await this.getConfig());
    const errors: string[] = [];
    const warnings: string[] = [];

    if (files.length > actualConfig.maxFilesPerMessage) {
      errors.push(`Maximum ${actualConfig.maxFilesPerMessage} files allowed per message`);
    }

    for (const file of files) {
      if (file.size > actualConfig.maxFileSize) {
        const maxSizeMB = actualConfig.maxFileSize / (1024 * 1024);
        errors.push(
          `${file.name}: File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds ${maxSizeMB}MB limit`
        );
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && !actualConfig.allowedExtensions.includes(ext)) {
        warnings.push(
          `${file.name}: Extension '.${ext}' is not in the common list, but will be attempted`
        );
      }

      // Check MIME type if available - only warn if it's clearly not text
      if (
        file.type &&
        !file.type.startsWith('text/') &&
        !actualConfig.allowedMimeTypes.includes(file.type)
      ) {
        warnings.push(`${file.name}: MIME type '${file.type}' may not be text-based`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async uploadFiles(
    files: File[],
    onProgress?: (progress: FileUploadProgress[]) => void
  ): Promise<FileAttachment[]> {
    const validation = await this.validateFiles(files);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    const apiBase = resolveApiBase();

    const progressData: FileUploadProgress[] = files.map((file, index) => ({
      fileId: `temp-${index}`,
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

      const response = await httpClient.post('/v1/files/upload', formData);

      const uploadedFiles = response.data.files;
      const result: FileAttachment[] = uploadedFiles.map((f: any, index: number) => {
        progressData[index].state = 'ready';
        progressData[index].progress = 100;
        progressData[index].fileId = f.id;

        return {
          id: f.id,
          file: files[index],
          name: f.originalFilename || f.filename,
          size: f.size,
          type: f.type,
          content: f.content, // Include text content from response
          downloadUrl: toAbsoluteUrl(f.url, apiBase),
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
};
