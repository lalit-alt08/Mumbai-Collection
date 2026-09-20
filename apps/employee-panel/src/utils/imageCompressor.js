/**
 * Client-Side Image Compression Utility for Employee Panel
 *
 * Requirements:
 * - Resize images to a maximum bounding box of 1600px while preserving aspect ratio.
 * - Do not upscale images with both dimensions <= 1600px.
 * - Prefer WebP at quality 0.85.
 * - Fall back to JPEG at quality 0.85 if WebP canvas export fails or is unsupported.
 * - Cleanly revoke all intermediate object URLs.
 * - Gracefully fall back to the original file if canvas processing encounters an error.
 */

export const MAX_COMPRESS_DIMENSION = 1600; // Product images (default)
export const BANNER_MAX_DIMENSION = 1920;   // Banner images (max 1920px on longest side)
export const CATEGORY_MAX_DIMENSION = 1200; // Category images (max 1200px on longest side)
export const DEFAULT_COMPRESS_QUALITY = 0.85;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit aligned with backend
export const RAW_IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25MB raw camera capture boundary prior to compression

/**
 * Validates whether a file is an acceptable image on mobile/desktop.
 * Supports standard web images, iOS HEIC/HEIF camera captures, and
 * camera temporary files with empty or generic MIME types.
 */
export const isAcceptedImage = (file) => {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase().trim();

  if (
    type.startsWith("image/") ||
    type === "image/heic" ||
    type === "image/heif"
  ) {
    return true;
  }

  const name = String(file.name || "").toLowerCase().trim();
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name);
};

/**
 * Helper to identify HEIC/HEIF images (commonly from iPhones/iPads).
 */
export const isHeicFile = (file) => {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase().trim();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = String(file.name || "").toLowerCase().trim();
  return /\.(heic|heif)$/i.test(name);
};

/**
 * Fast client-side image header parser to extract dimensions without full pixel decoding.
 * Avoids multi-hundred MB RGBA bitmap allocations for large camera photos on mobile devices.
 * Reads only the first 64KB chunk of the file.
 *
 * @param {Blob|File} file
 * @returns {Promise<{ width: number, height: number } | null>}
 */
export const parseImageDimensionsFromHeader = async (file) => {
  if (!file || typeof file.slice !== "function") return null;

  try {
    const headerChunk = file.slice(0, 65536);
    const arrayBuffer = await headerChunk.arrayBuffer();
    const view = new DataView(arrayBuffer);
    const len = view.byteLength;

    if (len < 10) return null;

    // 1. PNG: 89 50 4E 47 0D 0A 1A 0A -> Width at 16, Height at 20 (4 bytes big-endian)
    if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
      if (len >= 24) {
        return {
          width: view.getUint32(16, false),
          height: view.getUint32(20, false),
        };
      }
    }

    // 2. GIF: GIF87a or GIF89a -> Width at 6, Height at 8 (2 bytes little-endian)
    if (view.getUint8(0) === 0x47 && view.getUint8(1) === 0x49 && view.getUint8(2) === 0x46) {
      if (len >= 10) {
        return {
          width: view.getUint16(6, true),
          height: view.getUint16(8, true),
        };
      }
    }

    // 3. WebP: 'RIFF' .... 'WEBP'
    if (view.getUint32(0, false) === 0x52494646 && len >= 30) {
      const isWebP =
        view.getUint8(8) === 0x57 &&
        view.getUint8(9) === 0x45 &&
        view.getUint8(10) === 0x42 &&
        view.getUint8(11) === 0x50;
      if (isWebP) {
        // VP8 (lossy): 'VP8 ' at 12
        if (
          view.getUint8(12) === 0x56 &&
          view.getUint8(13) === 0x50 &&
          view.getUint8(14) === 0x38 &&
          view.getUint8(15) === 0x20 &&
          len >= 30
        ) {
          const w = view.getUint16(26, true) & 0x3fff;
          const h = view.getUint16(28, true) & 0x3fff;
          if (w > 0 && h > 0) return { width: w, height: h };
        }
        // VP8L (lossless): 'VP8L' at 12
        if (
          view.getUint8(12) === 0x56 &&
          view.getUint8(13) === 0x50 &&
          view.getUint8(14) === 0x38 &&
          view.getUint8(15) === 0x4c &&
          len >= 25
        ) {
          const b1 = view.getUint8(21);
          const b2 = view.getUint8(22);
          const b3 = view.getUint8(23);
          const b4 = view.getUint8(24);
          const w = 1 + (((b2 & 0x3f) << 8) | b1);
          const h = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
          if (w > 0 && h > 0) return { width: w, height: h };
        }
        // VP8X (extended): 'VP8X' at 12
        if (
          view.getUint8(12) === 0x56 &&
          view.getUint8(13) === 0x50 &&
          view.getUint8(14) === 0x38 &&
          view.getUint8(15) === 0x58 &&
          len >= 30
        ) {
          const w = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
          const h = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
          if (w > 0 && h > 0) return { width: w, height: h };
        }
      }
    }

    // 4. JPEG: Starts with FF D8
    if (view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8) {
      let offset = 2;
      while (offset < len - 1) {
        if (view.getUint8(offset) !== 0xff) {
          offset++;
          continue;
        }
        const marker = view.getUint8(offset + 1);
        if (marker === 0xff || marker === 0x00) {
          offset++;
          continue;
        }
        // SOF markers (SOF0..SOF3, SOF5..SOF7, SOF9..SOFB)
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb)
        ) {
          if (offset + 8 < len) {
            const height = view.getUint16(offset + 5, false);
            const width = view.getUint16(offset + 7, false);
            if (width > 0 && height > 0) {
              return { width, height };
            }
          }
          break;
        }

        if (offset + 3 < len) {
          const segmentLength = view.getUint16(offset + 2, false);
          offset += 2 + segmentLength;
        } else {
          break;
        }
      }
    }
  } catch {
    // Header sniff failure, safe fallback
  }

  return null;
};

/**
 * Calculate target dimensions bounded by maxDimension while preserving aspect ratio.
 * Never upscales images that already fit within maxDimension.
 *
 * @param {number} width - Original image width in pixels
 * @param {number} height - Original image height in pixels
 * @param {number} [maxDimension=1600] - Maximum allowable width or height
 * @returns {{ width: number, height: number }}
 */
export const calculateDimensions = (width, height, maxDimension = MAX_COMPRESS_DIMENSION) => {
  const w = Number(width);
  const h = Number(height);
  const max = Number(maxDimension) || MAX_COMPRESS_DIMENSION;

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }

  // If already within boundary, preserve original dimensions without enlargement
  if (w <= max && h <= max) {
    return { width: Math.round(w), height: Math.round(h) };
  }

  let targetWidth;
  let targetHeight;

  if (w >= h) {
    targetWidth = max;
    targetHeight = Math.round((h * max) / w);
  } else {
    targetHeight = max;
    targetWidth = Math.round((w * max) / h);
  }

  return {
    width: Math.max(1, targetWidth),
    height: Math.max(1, targetHeight),
  };
};

/**
 * Loads an image from a File or Blob into a drawable source.
 * Downscales during decode where supported via createImageBitmap resize options
 * before allocating full-sized canvas/RGBA buffers to prevent mobile OOM crashes.
 * Revokes intermediate object URLs cleanly.
 *
 * @param {Blob|File} file
 * @param {number} [maxDimension=1600]
 * @returns {Promise<{ width: number, height: number, draw: Function, cleanup?: Function }>}
 */
const loadImageSource = async (file, maxDimension = MAX_COMPRESS_DIMENSION) => {
  if (typeof createImageBitmap === "function") {
    // 1. Check if header dimensions can be extracted to downscale during decode
    let headerDims = null;
    try {
      headerDims = await parseImageDimensionsFromHeader(file);
    } catch {}

    if (headerDims && headerDims.width > 0 && headerDims.height > 0) {
      if (headerDims.width > maxDimension || headerDims.height > maxDimension) {
        const { width: targetWidth, height: targetHeight } = calculateDimensions(
          headerDims.width,
          headerDims.height,
          maxDimension
        );

        try {
          const bitmap = await createImageBitmap(file, {
            resizeWidth: targetWidth,
            resizeHeight: targetHeight,
            resizeQuality: "high",
            imageOrientation: "from-image",
          });

          return {
            width: bitmap.width,
            height: bitmap.height,
            draw: (ctx, w, h) => {
              ctx.drawImage(bitmap, 0, 0, w, h);
            },
            cleanup: () => {
              if (typeof bitmap.close === "function") {
                try {
                  bitmap.close();
                } catch {}
              }
            },
          };
        } catch {
          // If resize options are unsupported by browser, fall back to standard createImageBitmap
        }
      }
    }

    // 2. Standard createImageBitmap with auto-orientation
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => {
          ctx.drawImage(bitmap, 0, 0, w, h);
        },
        cleanup: () => {
          if (typeof bitmap.close === "function") {
            try {
              bitmap.close();
            } catch {}
          }
        },
      };
    } catch {
      // Fallback to Image element if createImageBitmap fails
    }
  }

  // 3. Fallback to HTMLImageElement
  return new Promise((resolve, reject) => {
    loadImageViaElement(file, resolve, reject);
  });
};

const loadImageViaElement = (file, resolve, reject) => {
  if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    reject(new Error("Image element or URL API unavailable"));
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      cleanup: () => {},
    });
  };

  img.onerror = (err) => {
    URL.revokeObjectURL(objectUrl);
    reject(err || new Error("Failed to load image in browser Image element."));
  };

  img.src = objectUrl;
};

/**
 * Promisified canvas.toBlob with mimeType and quality parameters.
 */
const exportCanvasToBlob = (canvas, mimeType, quality) => {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        mimeType,
        quality
      );
    } catch {
      resolve(null);
    }
  });
};

/**
 * Compresses an image File or Blob client-side:
 * - Resizes to maximum 1600px width/height while preserving aspect ratio.
 * - Encodes as WebP at quality 0.85.
 * - Automatically falls back to JPEG at quality 0.85 if WebP export is unsupported.
 * - Returns the original file untouched if compression fails or environment does not support canvas.
 *
 * @param {File|Blob} file - The image file to compress
 * @param {Object} [options] - Compression configuration options
 * @param {number} [options.maxDimension=1600] - Max bounding box dimension
 * @param {number} [options.quality=0.85] - Compression quality (0.0 to 1.0)
 * @returns {Promise<File|Blob>} The compressed File (or original file on error/fallback)
 */
export const compressImage = async (file, options = {}) => {
  if (!file) return file;

  // Ensure DOM and Canvas are available
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return file;
  }

  const maxDimension = Number(options.maxDimension) || MAX_COMPRESS_DIMENSION;
  const quality = typeof options.quality === "number" ? options.quality : DEFAULT_COMPRESS_QUALITY;

  let loaded = null;
  try {
    loaded = await loadImageSource(file, maxDimension);
    const { width: targetWidth, height: targetHeight } = calculateDimensions(
      loaded.width,
      loaded.height,
      maxDimension
    );

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      if (isHeicFile(file)) {
        const heicErr = new Error("HEIC format is not supported directly by your browser. Please select JPEG, PNG, or WebP.");
        heicErr.code = "HEIC_UNSUPPORTED";
        throw heicErr;
      }
      return file;
    }

    // Draw source onto canvas
    loaded.draw(ctx, targetWidth, targetHeight);

    // 1. Attempt WebP export at requested quality (0.85)
    let blob = await exportCanvasToBlob(canvas, "image/webp", quality);

    // 2. If WebP is unsupported by the browser or returned invalid mime/null, fallback to JPEG
    if (!blob || blob.type !== "image/webp") {
      // Create a canvas with a clean white background in case source image has alpha transparency
      const jpegCanvas = document.createElement("canvas");
      jpegCanvas.width = targetWidth;
      jpegCanvas.height = targetHeight;
      const jpegCtx = jpegCanvas.getContext("2d");

      if (jpegCtx) {
        jpegCtx.fillStyle = "#FFFFFF";
        jpegCtx.fillRect(0, 0, targetWidth, targetHeight);
        loaded.draw(jpegCtx, targetWidth, targetHeight);
        blob = await exportCanvasToBlob(jpegCanvas, "image/jpeg", quality);
      } else {
        blob = await exportCanvasToBlob(canvas, "image/jpeg", quality);
      }
    }

    if (!blob) {
      if (isHeicFile(file)) {
        const heicErr = new Error("HEIC format is not supported directly by your browser. Please select JPEG, PNG, or WebP.");
        heicErr.code = "HEIC_UNSUPPORTED";
        throw heicErr;
      }
      return file;
    }

    // Derive proper clean filename
    const originalName = file.name || "product_image";
    const baseName = originalName.replace(/\.[^/.]+$/, "") || "product_image";
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const newFileName = `${baseName}.${ext}`;

    // Return a File instance preserving File API compatibility
    if (typeof File === "function") {
      try {
        return new File([blob], newFileName, {
          type: blob.type,
          lastModified: Date.now(),
        });
      } catch {
        blob.name = newFileName;
        return blob;
      }
    }

    blob.name = newFileName;
    return blob;
  } catch (err) {
    if (isHeicFile(file) || err?.code === "HEIC_UNSUPPORTED") {
      const heicErr = new Error("HEIC format is not supported directly by your browser. Please select JPEG, PNG, or WebP.");
      heicErr.code = "HEIC_UNSUPPORTED";
      throw heicErr;
    }
    console.warn("Client image compression error, using original file:", err);
    return file;
  } finally {
    if (loaded && typeof loaded.cleanup === "function") {
      try {
        loaded.cleanup();
      } catch {}
    }
  }
};

export default {
  MAX_COMPRESS_DIMENSION,
  BANNER_MAX_DIMENSION,
  CATEGORY_MAX_DIMENSION,
  DEFAULT_COMPRESS_QUALITY,
  MAX_FILE_SIZE_BYTES,
  RAW_IMAGE_MAX_INPUT_BYTES,
  isAcceptedImage,
  isHeicFile,
  parseImageDimensionsFromHeader,
  calculateDimensions,
  compressImage,
};
