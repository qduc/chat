import express from 'express';
import multer from '../lib/multerShim.js';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { createFileRecord, getFileRecordForUser } from '../db/files.js';

const router = express.Router();

// File configuration
const FILE_CONFIG = {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  maxFilesPerMessage: 3,
  allowedExtensions: [
    'js', 'jsx', 'ts', 'tsx', // JavaScript/TypeScript
    'py', 'rb', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'php', // Other languages
    'html', 'css', 'scss', 'sass', 'less', // Web
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', // Config
    'md', 'txt', 'csv', 'log', // Documents
    'sh', 'bash', 'zsh', 'fish', // Shell scripts
    'sql', 'graphql', // Query languages
    'dockerfile', 'makefile', 'gitignore', 'editorconfig' // Build/config files
  ],
  allowedMimeTypes: [
    'text/plain',
    'text/javascript',
    'application/javascript',
    'text/x-python',
    'application/json',
    'text/markdown',
    'text/x-markdown',
    'text/csv',
    'application/xml',
    'text/xml',
    'text/html',
    'text/css',
    'application/x-yaml',
    'text/yaml'
  ],
  // Allow overriding storage path via env so it can be mounted to a volume
  localStoragePath: process.env.FILE_STORAGE_PATH || './data/files',
  uploadRateLimit: 10, // per minute
  storageLimitPerUser: 50 * 1024 * 1024, // 50MB
};

// Ensure upload directory exists
const uploadDir = path.resolve(FILE_CONFIG.localStoragePath);
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidFileId(id) {
  return typeof id === 'string' && FILE_ID_PATTERN.test(id);
}

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for processing
const upload = multer({
  storage,
  limits: {
    fileSize: FILE_CONFIG.maxFileSize,
    files: FILE_CONFIG.maxFilesPerMessage,
  },
  fileFilter: (req, file, cb) => {
    // Get extension from filename
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mimeType = file.mimetype.toLowerCase();

    // Allow files without extension if they match allowed MIME types
    const hasValidExtension = FILE_CONFIG.allowedExtensions.includes(ext);
    const hasValidMimeType = FILE_CONFIG.allowedMimeTypes.includes(mimeType) ||
                              mimeType.startsWith('text/');

    if (hasValidExtension || hasValidMimeType) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed extensions: ${FILE_CONFIG.allowedExtensions.join(', ')}`), false);
    }
  }
});

// Ensure upload directory exists on startup
(async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    logger.info({ msg: 'files:directory_created', path: uploadDir });
  } catch (error) {
    logger.error({ msg: 'files:directory_error', error: error.message, path: uploadDir });
  }
})();

/**
 * POST /v1/files/upload
 * Upload text files for use in chat messages
 */
router.post('/v1/files/upload', authenticateToken, upload.array('files', FILE_CONFIG.maxFilesPerMessage), async (req, res) => {
  try {
    const userId = req.user.id;
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        error: 'no_files',
        message: 'No files provided'
      });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        const fileId = nanoid();
        const ext = path.extname(file.originalname || '').toLowerCase();
        const storageFilename = `${fileId}${ext || '.txt'}`;
        const filePath = path.join(uploadDir, storageFilename);

        // Read file content as text
        let content = null;
        try {
          content = file.buffer.toString('utf-8');
        } catch (decodeError) {
          logger.warn({
            msg: 'files:decode_warning',
            error: decodeError.message,
            filename: file.originalname
          });
          // Continue without content - file will still be stored
        }

        // Write file to disk
        await fs.writeFile(filePath, file.buffer);

        // Store metadata in database
        try {
          createFileRecord({
            id: fileId,
            userId,
            storageFilename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            content, // Store text content for LLM context
          });
        } catch (metadataError) {
          // Clean up the file on metadata failure
          await fs.unlink(filePath).catch(() => {});
          throw metadataError;
        }

        const baseUrl = `/v1/files/${fileId}`;

        results.push({
          id: fileId,
          url: baseUrl,
          filename: storageFilename,
          originalFilename: file.originalname,
          size: file.size,
          type: file.mimetype,
          content: content, // Include content in response for immediate use
        });

        logger.info({
          msg: 'files:uploaded',
          fileId,
          storageFilename,
          size: file.size,
          userId
        });

      } catch (error) {
        logger.error({
          msg: 'files:upload_error',
          error: error.message,
          filename: file.originalname,
          userId
        });

        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    // Return results
    if (results.length > 0 && errors.length === 0) {
      res.json({
        success: true,
        files: results
      });
    } else if (results.length > 0 && errors.length > 0) {
      res.status(207).json({ // 207 Multi-Status
        success: true,
        files: results,
        errors
      });
    } else {
      res.status(400).json({
        success: false,
        errors
      });
    }

  } catch (error) {
    logger.error({
      msg: 'files:upload_handler_error',
      error: error.message,
      userId: req.user?.id
    });

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File size exceeds ${FILE_CONFIG.maxFileSize / (1024 * 1024)}MB limit`
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        error: 'too_many_files',
        message: `Maximum ${FILE_CONFIG.maxFilesPerMessage} files allowed`
      });
    }

    res.status(500).json({
      error: 'upload_failed',
      message: 'File upload failed'
    });
  }
});

/**
 * GET /v1/files/config
 * Get file configuration for frontend validation
 */
router.get('/v1/files/config', (req, res) => {
  res.json({
    maxFileSize: FILE_CONFIG.maxFileSize,
    maxFilesPerMessage: FILE_CONFIG.maxFilesPerMessage,
    allowedExtensions: FILE_CONFIG.allowedExtensions,
    allowedMimeTypes: FILE_CONFIG.allowedMimeTypes,
    uploadRateLimit: FILE_CONFIG.uploadRateLimit,
    storageLimitPerUser: FILE_CONFIG.storageLimitPerUser,
  });
});

/**
 * GET /v1/files/:fileId
 * Serve uploaded files (requires authentication and ownership)
 */
router.get('/v1/files/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    if (!isValidFileId(fileId)) {
      return res.status(400).json({
        error: 'invalid_file_id',
        message: 'Invalid file identifier'
      });
    }

    const metadata = getFileRecordForUser({ id: fileId, userId });
    if (!metadata) {
      return res.status(404).json({
        error: 'not_found',
        message: 'File not found'
      });
    }

    const filePath = path.join(uploadDir, metadata.storageFilename);

    try {
      await fs.access(filePath);
    } catch {
      logger.warn({
        msg: 'files:file_missing',
        fileId,
        filePath,
        userId,
      });
      return res.status(404).json({
        error: 'not_found',
        message: 'File not found'
      });
    }

    const stats = await fs.stat(filePath);
    const ext = path.extname(metadata.storageFilename).toLowerCase();

    const contentTypeMap = {
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.py': 'text/x-python',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.xml': 'application/xml',
      '.yaml': 'application/x-yaml',
      '.yml': 'application/x-yaml',
    };

    const contentType = metadata.mimeType || contentTypeMap[ext] || 'text/plain';
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const fileBuffer = await fs.readFile(filePath);
    res.send(fileBuffer);

  } catch (error) {
    logger.error({
      msg: 'files:serve_error',
      error: error.message,
      fileId: req.params.fileId,
      userId: req.user?.id,
    });

    res.status(500).json({
      error: 'serve_failed',
      message: 'Failed to serve file'
    });
  }
});

export { router as filesRouter };
