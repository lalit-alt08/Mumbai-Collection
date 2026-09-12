import { imageSize } from "image-size";

/**
 * Image Validation Utility
 * Enforces magic-byte verification, server-derived extension, filename sanitization,
 * and maximum dimension boundaries (pixel-flood / decompression-bomb guard).
 */

const MAX_IMAGE_WIDTH = 6000;
const MAX_IMAGE_HEIGHT = 6000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // Existing admin limit
export const EMPLOYEE_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const FORMAT_TYPES = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

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

const hasJpegEndMarker = (buffer) =>
  buffer.length >= 4 && buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 2;

const hasPngStructure = (buffer) => {
  if (buffer.length < 33) return false;

  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > buffer.length) return false;
    if (chunkType === "IHDR") {
      if (sawHeader || length !== 13) return false;
      sawHeader = true;
    }
    if (chunkType === "IEND") {
      if (length !== 0) return false;
      sawEnd = true;
      break;
    }

    offset = chunkEnd;
  }

  return sawHeader && sawEnd;
};

const hasGifStructure = (buffer) =>
  buffer.length >= 14 && buffer.lastIndexOf(0x3b) >= 13;

const hasWebpStructure = (buffer) => {
  if (buffer.length < 20) return false;
  const declaredRiffSize = buffer.readUInt32LE(4);
  // RIFF size excludes the first 8 bytes. Extra trailing bytes are allowed.
  return declaredRiffSize >= 12 && declaredRiffSize + 8 <= buffer.length;
};

const hasSafeStructure = (buffer, format) => {
  switch (format) {
    case "jpeg":
      return hasJpegEndMarker(buffer);
    case "png":
      return hasPngStructure(buffer);
    case "webp":
      return hasWebpStructure(buffer);
    case "gif":
      return hasGifStructure(buffer);
    default:
      return false;
  }
};

/**
 * Parse dimensions for every supported image format. image-size reads only
 * bounded headers; the structure checks above reject truncated streams before
 * any media is sent to WordPress.
 */
export const checkImageDimensions = (buffer, format) => {
  if (!buffer || !FORMAT_TYPES[format] || !hasSafeStructure(buffer, format)) {
    return { valid: false, width: null, height: null };
  }

  try {
    const dimensions = imageSize(buffer);
    const expectedType = FORMAT_TYPES[format];
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);

    if (dimensions?.type !== expectedType || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return { valid: false, width: null, height: null };
    }

    return {
      valid: width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT,
      width,
      height,
    };
  } catch {
    return { valid: false, width: null, height: null };
  }
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
export const validateImageBuffer = (file, options = {}) => {
  if (!file || !file.buffer) {
    return { valid: false, message: "No file data received." };
  }

  const maxFileSizeBytes = Number(options.maxFileSizeBytes) || MAX_IMAGE_SIZE_BYTES;
  if (file.buffer.length > maxFileSizeBytes) {
    const maxSizeMb = Math.floor(maxFileSizeBytes / (1024 * 1024));
    return { valid: false, message: `File size exceeds the ${maxSizeMb}MB limit.` };
  }

  const detected = detectImageFormat(file.buffer);
  if (!detected) {
    return {
      valid: false,
      message: "Invalid file signature. Only authentic JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }

  const dimensions = checkImageDimensions(file.buffer, detected.format);
  if (!dimensions.valid) {
    return {
      valid: false,
      message: "Invalid or unsupported image data. The image may be malformed or exceed the 6000x6000 pixel limit.",
    };
  }

  // Mutate file metadata with server-derived safe values
  file.mimetype = detected.mime;
  file.originalname = sanitizeFilename(file.originalname, detected.ext);

  return {
    valid: true,
    format: detected.format,
    ext: detected.ext,
    width: dimensions.width,
    height: dimensions.height,
  };
};
