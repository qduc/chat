import busboy from 'busboy';

// Minimal multer-like shim used for tests and basic multipart parsing.
// Implements memory storage and an `array(field, maxCount)` middleware.
// This intentionally implements only the features the app uses so it stays small
// and avoids depending on a specific multer package implementation.

export function memoryStorage() {
  return {};
}

export default function multer(options = {}) {
  const limitsFromOptions = options.limits || {};

  function array(fieldName, maxCount) {
    return (req, res, next) => {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        // Not a multipart request; let downstream handlers decide.
        return next();
      }

      const busboyOptions = { headers: req.headers, limits: {} };
      if (limitsFromOptions.fileSize) busboyOptions.limits.fileSize = limitsFromOptions.fileSize;
      if (maxCount) busboyOptions.limits.files = maxCount;

      const busboyInstance = busboy(busboyOptions);
      const files = [];
      let firstError = null;

      function handleError(err) {
        if (!firstError) firstError = err;
      }

      busboyInstance.on('file', (fieldName_actual, fileStream, info) => {
        const { filename, encoding, mimeType } = info;

        if (fieldName_actual !== fieldName) {
          // Ignore files for other fields
          fileStream.resume();
          return;
        }

        // fileFilter emulation
        if (typeof options.fileFilter === 'function') {
          let fileAccepted = true;
          try {
            options.fileFilter(req, { originalname: filename, mimetype: mimeType }, (err, accept) => {
              if (err) return handleError(err);
              if (!accept) fileAccepted = false;
            });
          } catch (err) {
            return handleError(err);
          }

          if (!fileAccepted) {
            // skip reading the file
            fileStream.resume();
            return;
          }
        }

        const chunks = [];
        let size = 0;

        fileStream.on('data', (chunk) => {
          chunks.push(chunk);
          size += chunk.length;
          if (limitsFromOptions.fileSize && size > limitsFromOptions.fileSize) {
            const err = new Error('File too large');
            err.code = 'LIMIT_FILE_SIZE';
            handleError(err);
            // Stop reading further from this stream
            fileStream.resume();
          }
        });

        fileStream.on('limit', () => {
          const err = new Error('File size limit reached');
          err.code = 'LIMIT_FILE_SIZE';
          handleError(err);
        });

        fileStream.on('close', () => {
          if (firstError) return;

          files.push({
            fieldname: fieldName_actual,
            originalname: filename,
            encoding,
            mimetype: mimeType,
            buffer: Buffer.concat(chunks),
            size,
          });

          if (maxCount && files.length > maxCount) {
            const err = new Error('Too many files');
            err.code = 'LIMIT_FILE_COUNT';
            handleError(err);
          }
        });
      });

      busboyInstance.on('filesLimit', () => {
        const err = new Error('Too many files');
        err.code = 'LIMIT_FILE_COUNT';
        handleError(err);
      });

      busboyInstance.on('error', (err) => handleError(err));

      busboyInstance.on('finish', () => {
        if (firstError) return next(firstError);
        req.files = files;
        return next();
      });

      req.pipe(busboyInstance);
    };
  }

  return { array };
}

// Keep the original multer API shape used by the codebase (multer.memoryStorage()).
multer.memoryStorage = memoryStorage;
