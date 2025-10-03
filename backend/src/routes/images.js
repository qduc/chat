import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = express.Router();

// Image configuration - these should eventually come from config
const IMAGE_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDimensions: { width: 4096, height: 4096 },
  maxImagesPerMessage: 5,
  allowedFormats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
  storageProvider: 'local',
  localStoragePath: './data/images',
  enableCompression: true,
  compressionQuality: 0.8,
  generateThumbnails: false, // Disable for now
  uploadRateLimit: 10, // per minute
  storageLimitPerUser: 100 * 1024 * 1024, // 100MB
};

// Ensure upload directory exists
const uploadDir = path.resolve(IMAGE_CONFIG.localStoragePath);

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for processing
const upload = multer({
  storage,
  limits: {
    fileSize: IMAGE_CONFIG.maxFileSize,
    files: IMAGE_CONFIG.maxImagesPerMessage,
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mimeType = file.mimetype.toLowerCase();

    const validExtensions = IMAGE_CONFIG.allowedFormats;
    const validMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (validExtensions.includes(ext) && validMimeTypes.includes(mimeType)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${validExtensions.join(', ')}`), false);
    }
  }
});

// Ensure upload directory exists on startup
(async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    logger.info({ msg: 'images:directory_created', path: uploadDir });
  } catch (error) {
    logger.error({ msg: 'images:directory_error', error: error.message, path: uploadDir });
  }
})();

/**
 * POST /v1/images/upload
 * Upload image files for use in chat messages
 */
router.post('/v1/images/upload', authenticateToken, upload.array('images', IMAGE_CONFIG.maxImagesPerMessage), async (req, res) => {
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
        // Generate unique filename
        const imageId = nanoid();
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${imageId}${ext}`;
        const filePath = path.join(uploadDir, filename);

        // Write file to disk
        await fs.writeFile(filePath, file.buffer);

        // Generate URL for frontend access
        // In production, this would be a CDN URL or proper image service URL
        const url = `/v1/images/${filename}`;

        // TODO: Store image metadata in database for production use
        // const imageData = { id: imageId, filename, originalName: file.originalname, url, size: file.size, type: file.mimetype, userId, createdAt: new Date().toISOString() };

        results.push({
          id: imageId,
          url,
          filename,
          size: file.size,
          type: file.mimetype,
          alt: file.originalname,
        });

        logger.info({
          msg: 'images:uploaded',
          imageId,
          filename,
          size: file.size,
          userId
        });

      } catch (error) {
        logger.error({
          msg: 'images:upload_error',
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
        images: results
      });
    } else if (results.length > 0 && errors.length > 0) {
      res.status(207).json({ // 207 Multi-Status
        success: true,
        images: results,
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
      msg: 'images:upload_handler_error',
      error: error.message,
      userId: req.user?.id
    });

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `File size exceeds ${IMAGE_CONFIG.maxFileSize / (1024 * 1024)}MB limit`
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        error: 'too_many_files',
        message: `Maximum ${IMAGE_CONFIG.maxImagesPerMessage} files allowed`
      });
    }

    res.status(500).json({
      error: 'upload_failed',
      message: 'Image upload failed'
    });
  }
});

/**
 * GET /v1/images/:filename
 * Serve uploaded images
 */
router.get('/v1/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // Basic security check - prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        error: 'invalid_filename',
        message: 'Invalid filename'
      });
    }

    const filePath = path.join(uploadDir, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        error: 'not_found',
        message: 'Image not found'
      });
    }

    // Get file stats and set appropriate headers
    const stats = await fs.stat(filePath);
    const ext = path.extname(filename).toLowerCase();

    // Set content type based on extension
    const contentTypeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    res.setHeader('ETag', `"${stats.mtime.getTime()}-${stats.size}"`);

    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

    if (ifNoneMatch === etag) {
      return res.status(304).end();
    }

    // Stream the file
    const fileBuffer = await fs.readFile(filePath);
    res.send(fileBuffer);

  } catch (error) {
    logger.error({
      msg: 'images:serve_error',
      error: error.message,
      filename: req.params.filename
    });

    res.status(500).json({
      error: 'serve_failed',
      message: 'Failed to serve image'
    });
  }
});

/**
 * GET /v1/images/config
 * Get image configuration for frontend validation
 */
router.get('/v1/images/config', (req, res) => {
  res.json({
    maxFileSize: IMAGE_CONFIG.maxFileSize,
    maxDimensions: IMAGE_CONFIG.maxDimensions,
    maxImagesPerMessage: IMAGE_CONFIG.maxImagesPerMessage,
    allowedFormats: IMAGE_CONFIG.allowedFormats,
    uploadRateLimit: IMAGE_CONFIG.uploadRateLimit,
    storageLimitPerUser: IMAGE_CONFIG.storageLimitPerUser,
  });
});

export { router as imagesRouter };