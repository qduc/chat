import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { storeImageMetadata, getImageMetadataForUser } from '../lib/images/metadataStore.js';
import { config } from '../env.js';

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
  downloadTokenTTL: Number(process.env.IMAGE_DOWNLOAD_TOKEN_TTL) || 10 * 60, // 10 minutes
};

// Ensure upload directory exists
const uploadDir = path.resolve(IMAGE_CONFIG.localStoragePath);
const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const IMAGE_TOKEN_SECRET = `${config.auth.jwtSecret || 'development-secret-key-change-in-production'}:image-access`; // Scoped secret salt

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  try {
    return Buffer.from(normalized + '='.repeat(padding), 'base64');
  } catch {
    return null;
  }
}

function generateImageAccessToken({ imageId, userId, ttl = IMAGE_CONFIG.downloadTokenTTL }) {
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : IMAGE_CONFIG.downloadTokenTTL;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + safeTtl;
  const payload = {
    imageId,
    userId,
    iat: issuedAt,
    exp: expiresAt,
    v: 1,
  };

  const payloadBuffer = Buffer.from(JSON.stringify(payload));
  const encodedPayload = toBase64Url(payloadBuffer);
  const signature = createHmac('sha256', IMAGE_TOKEN_SECRET)
    .update(encodedPayload)
    .digest();
  const encodedSignature = toBase64Url(signature);

  return {
    token: `${encodedPayload}.${encodedSignature}`,
    expiresAt,
    issuedAt,
  };
}

function verifyImageAccessToken(token, { imageId }) {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = parts;
  const signatureBuffer = fromBase64Url(encodedSignature);
  if (!signatureBuffer) {
    return null;
  }

  const expectedSignature = createHmac('sha256', IMAGE_TOKEN_SECRET)
    .update(encodedPayload)
    .digest();

  if (signatureBuffer.length !== expectedSignature.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedSignature)) {
    return null;
  }

  const payloadBuffer = fromBase64Url(encodedPayload);
  if (!payloadBuffer) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(payloadBuffer.toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || payload.imageId !== imageId || typeof payload.userId !== 'string') {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function buildSignedImageUrl(imageId, token) {
  return `/v1/images/${imageId}?token=${encodeURIComponent(token)}`;
}

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
        const access = generateImageAccessToken({ imageId, userId });
        const signedUrl = buildSignedImageUrl(imageId, access.token);

        results.push({
          id: imageId,
          url: baseUrl,
          downloadUrl: signedUrl,
          accessToken: access.token,
          expiresAt: new Date(access.expiresAt * 1000).toISOString(),
          expiresIn: access.expiresAt - access.issuedAt,
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
 * GET /v1/images/:imageId/sign
 * Generate a short-lived signed URL for direct image download
 */
router.get('/v1/images/:imageId/sign', authenticateToken, async (req, res) => {
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

    const access = generateImageAccessToken({ imageId, userId });
    const downloadUrl = buildSignedImageUrl(imageId, access.token);
    const nowSeconds = Math.floor(Date.now() / 1000);

    res.json({
      url: downloadUrl,
      token: access.token,
      expiresAt: new Date(access.expiresAt * 1000).toISOString(),
      expiresIn: Math.max(access.expiresAt - nowSeconds, 0),
    });
  } catch (error) {
    logger.error({
      msg: 'images:sign_error',
      error: error.message,
      imageId: req.params.imageId,
      userId: req.user?.id,
    });

    res.status(500).json({
      error: 'sign_failed',
      message: 'Failed to generate signed URL'
    });
  }
});

/**
 * GET /v1/images/:imageId
 * Serve uploaded images (requires authentication and ownership)
 */
router.get('/v1/images/:imageId', optionalAuth, async (req, res) => {
  let tokenPayload = null;
  try {
    const { imageId } = req.params;
    const tokenParam = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;

    if (!isValidImageId(imageId)) {
      return res.status(400).json({
        error: 'invalid_image_id',
        message: 'Invalid image identifier'
      });
    }

  let userId = req.user?.id || null;

    if (typeof tokenParam === 'string' && tokenParam.length > 0) {
      tokenPayload = verifyImageAccessToken(tokenParam, { imageId });
      if (!tokenPayload) {
        return res.status(403).json({
          error: 'invalid_token',
          message: 'Invalid or expired access token'
        });
      }

      if (userId && userId !== tokenPayload.userId) {
        return res.status(403).json({
          error: 'invalid_token',
          message: 'Token does not match authenticated user'
        });
      }

      userId = userId || tokenPayload.userId;
    }

    if (!userId) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Authentication required to access this image'
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
      userId: req.user?.id || tokenPayload?.userId,
    });

    res.status(500).json({
      error: 'serve_failed',
      message: 'Failed to serve image'
    });
  }
});

export { router as imagesRouter };
