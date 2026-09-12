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
 * Attempts createImageBitmap first (for performance and auto-orientation),
 * falling back to an HTMLImageElement if unsupported.
 * Revokes the created object URL as soon as the image loads.
 *
 * @param {Blob|File} file
 * @returns {Promise<{ width: number, height: number, draw: Function }>}
 */
const loadImageSource = (file) => {
  return new Promise((resolve, reject) => {
    // Attempt createImageBitmap with auto-orientation if supported
    if (typeof createImageBitmap === "function") {
      const options = { imageOrientation: "from-image" };
      createImageBitmap(file, options)
        .then((bitmap) => {
          resolve({
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
          });
        })
        .catch(() => {
          // Fallback to Image element if createImageBitmap with options fails
          loadImageViaElement(file, resolve, reject);
        });
      return;
    }

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
    loaded = await loadImageSource(file);
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
  calculateDimensions,
  compressImage,
};
