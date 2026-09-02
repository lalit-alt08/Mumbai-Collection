/**
 * Image Validation Utility
 * Enforces magic-byte verification, server-derived extension, filename sanitization,
 * and maximum dimension boundaries (pixel-flood / decompression-bomb guard).
 */

const MAX_IMAGE_WIDTH = 6000;
const MAX_IMAGE_HEIGHT = 6000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Identify real image format by inspecting magic bytes
 */
export const detectImageFormat = (buffer) => {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: "jpeg", ext: "jpg", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: "png", ext: "png", mime: "image/png" };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { format: "gif", ext: "gif", mime: "image/gif" };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { format: "webp", ext: "webp", mime: "image/webp" };
  }

  return null;
};

/**
 * Inspect image header dimensions (PNG and GIF) to protect against decompression bombs
 */
export const checkImageDimensions = (buffer, format) => {
  if (!buffer || buffer.length < 24) return true;

  try {
    if (format === "png") {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
        return false;
      }
    } else if (format === "gif") {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
        return false;
      }
    }
  } catch {
    // If dimension parsing fails on non-standard chunks, allow processing
    return true;
  }

  return true;
};

/**
 * Sanitize filename to prevent directory traversal or control characters
 */
export const sanitizeFilename = (filename = "upload", safeExt = "jpg") => {
  const baseName = filename
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  const cleanBase = baseName || "image";
  return `${cleanBase}_${Date.now()}.${safeExt}`;
};

/**
 * Comprehensive Image Validation
 */
export const validateImageBuffer = (file) => {
  if (!file || !file.buffer) {
    return { valid: false, message: "No file data received." };
  }

  if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
    return { valid: false, message: "File exceeds maximum size limit of 10MB." };
  }

  const detected = detectImageFormat(file.buffer);
  if (!detected) {
    return {
      valid: false,
      message: "Invalid file signature. Only authentic JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }

  if (!checkImageDimensions(file.buffer, detected.format)) {
    return {
      valid: false,
      message: `Image dimensions exceed maximum allowed limit of ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT} pixels.`,
    };
  }

  // Mutate file metadata with server-derived safe values
  file.mimetype = detected.mime;
  file.originalname = sanitizeFilename(file.originalname, detected.ext);

  return { valid: true, format: detected.format, ext: detected.ext };
};
