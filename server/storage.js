const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where SOS images live on disk. Kept outside the DB so a 1MB photo never
// travels through SQLite or a socket payload — only its URL does.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const PUBLIC_PATH = '/uploads';

// Decoded image size limit (the base64 text is ~33% bigger than this).
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 5 * 1024 * 1024;

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isSupportedMime(mimeType) {
  return Boolean(MIME_EXTENSIONS[String(mimeType).toLowerCase()]);
}

function sanitizeFileName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.trim().replace(/[\r\n\t]/g, '').slice(0, 120);
  return cleaned || null;
}

/**
 * Writes a base64 data URI to disk and returns the public URL for it.
 * Returns { url, mimeType, fileName, bytes }.
 */
function saveDataUri(dataUri, { mimeType, fileName } = {}) {
  const match = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(dataUri);
  if (!match) throw httpError('Image must be a base64 data URI or an http(s) URL', 400);

  const detectedMime = match[1].toLowerCase();
  const base64 = match[2];

  if (!isSupportedMime(detectedMime)) {
    throw httpError(`Unsupported image type: ${detectedMime}`, 415);
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw httpError('Image data could not be decoded', 400);
  }

  if (!buffer.length) throw httpError('Image data is empty', 400);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw httpError('Image is too large. Please attach a smaller image.', 413);
  }

  const extension = MIME_EXTENSIONS[detectedMime];
  const diskName = `sos-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, diskName), buffer);

  return {
    url: `${PUBLIC_PATH}/${diskName}`,
    mimeType: isSupportedMime(mimeType) ? String(mimeType).toLowerCase() : detectedMime,
    fileName: sanitizeFileName(fileName) || diskName,
    bytes: buffer.length,
  };
}

/**
 * Accepts either a base64 data URI (stored on disk) or an already-hosted
 * http(s) URL (stored as-is). Returns null when no image was attached.
 */
function storeImage(input) {
  if (!input) return null;

  const raw =
    typeof input === 'string' ? input :
    typeof input.dataUri === 'string' ? input.dataUri :
    typeof input.url === 'string' ? input.url :
    '';

  const value = raw.trim();
  if (!value) return null;

  if (/^data:/i.test(value)) {
    return saveDataUri(value, {
      mimeType: typeof input === 'object' ? input.mimeType : null,
      fileName: typeof input === 'object' ? input.fileName : null,
    });
  }

  if (/^https?:\/\/\S+$/i.test(value)) {
    if (value.length > 2000) throw httpError('Image URL is too long', 400);
    return {
      url: value,
      mimeType: typeof input === 'object' && isSupportedMime(input.mimeType)
        ? String(input.mimeType).toLowerCase()
        : null,
      fileName: (typeof input === 'object' && sanitizeFileName(input.fileName)) || null,
      bytes: null,
    };
  }

  throw httpError('Image must be a base64 data URI or an http(s) URL', 400);
}

function deleteStoredImage(url) {
  if (typeof url !== 'string' || !url.startsWith(`${PUBLIC_PATH}/`)) return;
  const diskName = path.basename(url);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, diskName));
  } catch {
    // already gone — nothing to clean up
  }
}

module.exports = {
  UPLOAD_DIR,
  PUBLIC_PATH,
  MAX_IMAGE_BYTES,
  storeImage,
  deleteStoredImage,
};
