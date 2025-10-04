import express from 'express';
import multer from '../lib/multerShim.js';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { storeImageMetadata, getImageMetadataForUser } from '../lib/images/metadataStore.js';

const router = express.Router();

// Image configuration - these should eventually come from config
const IMAGE_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDimensions: { width: 4096, height: 4096 },
  maxImagesPerMessage: 5,
  allowedFormats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
  storageProvider: 'local',
  // Allow overriding storage path via env so it can be mounted to a volume
  localStoragePath: process.env.IMAGE_STORAGE_PATH || './data/images',
  enableCompression: true,
  compressionQuality: 0.8,
  generateThumbnails: false, // Disable for now
  uploadRateLimit: 10, // per minute
  storageLimitPerUser: 100 * 1024 * 1024, // 100MB
};

// Ensure upload directory exists
const uploadDir = path.resolve(IMAGE_CONFIG.localStoragePath);
const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidImageId(id) {
  return typeof id === 'string' && IMAGE_ID_PATTERN.test(id);
}

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
        const imageId = nanoid();
        const ext = path.extname(file.originalname || '').toLowerCase();
        const storageFilename = `${imageId}${ext}`;
        const filePath = path.join(uploadDir, storageFilename);

        await fs.writeFile(filePath, file.buffer);

        try {
          storeImageMetadata({
            id: imageId,
            userId,
            storageFilename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          });
        } catch (metadataError) {
          // Clean up the file on metadata failure
          await fs.unlink(filePath).catch(() => {});
          throw metadataError;
        }

        const baseUrl = `/v1/images/${imageId}`;

        results.push({
          id: imageId,
          url: baseUrl,
          filename: storageFilename,
          originalFilename: file.originalname,
          size: file.size,
          type: file.mimetype,
          alt: file.originalname,
        });

        logger.info({
          msg: 'images:uploaded',
          imageId,
          storageFilename,
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


/**
 * GET /v1/images/:imageId
 * Serve uploaded images (requires authentication and ownership)
 */
router.get('/v1/images/:imageId', authenticateToken, async (req, res) => {
  try {
    const { imageId } = req.params;
    const userId = req.user.id;

    if (!isValidImageId(imageId)) {
      return res.status(400).json({
        error: 'invalid_image_id',
        message: 'Invalid image identifier'
      });
    }

    const metadata = getImageMetadataForUser(imageId, userId);
    if (!metadata) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Image not found'
      });
    }

    const filePath = path.join(uploadDir, metadata.storageFilename);

    try {
      await fs.access(filePath);
    } catch {
      logger.warn({
        msg: 'images:file_missing',
        imageId,
        filePath,
        userId,
      });
      return res.status(404).json({
        error: 'not_found',
        message: 'Image not found'
      });
    }

    const stats = await fs.stat(filePath);
    const ext = path.extname(metadata.storageFilename).toLowerCase();

    const contentTypeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };

    const contentType = metadata.mimeType || contentTypeMap[ext] || 'application/octet-stream';
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
      msg: 'images:serve_error',
      error: error.message,
      imageId: req.params.imageId,
      userId: req.user?.id,
    });

    res.status(500).json({
      error: 'serve_failed',
      message: 'Failed to serve image'
    });
  }
});

export { router as imagesRouter };
