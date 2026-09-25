import sharp from "sharp";

export const MAX_PROCESSED_DIMENSION = 1600;
export const WEBP_QUALITY = 82;
export const MAX_INPUT_PIXELS = 36000000; // 36 MP max (matches MAX_IMAGE_WIDTH 6000 x MAX_IMAGE_HEIGHT 6000)

/**
 * Process an image buffer using Sharp for employee product uploads:
 * 1. Auto-rotate based on EXIF orientation tag and clear orientation flag.
 * 2. Strip all EXIF, GPS, and camera metadata (Sharp strips metadata by default when not using withMetadata).
 * 3. Resize bounding box to max 1600px width / height (fit: 'inside', withoutEnlargement: true).
 * 4. Encode to WebP format at quality 82.
 * 5. Restrict input pixel flood (limitInputPixels) and animated multi-frame decoding (pages: 1).
 *
 * @param {Buffer} buffer - Input image buffer (JPEG, PNG, WebP, GIF)
 * @param {Object} [options] - Optional overrides for dimension or quality
 * @returns {Promise<{ buffer: Buffer, format: string, mime: string, ext: string, width: number, height: number, size: number, info: Object }>}
 */
export const processProductImage = async (buffer, options = {}) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Invalid or missing image buffer for processing.");
  }

  const maxWidth = Number(options.maxWidth) || MAX_PROCESSED_DIMENSION;
  const maxHeight = Number(options.maxHeight) || MAX_PROCESSED_DIMENSION;
  const quality = Number(options.quality) || WEBP_QUALITY;
  const limitInputPixels = Number(options.limitInputPixels) || MAX_INPUT_PIXELS;

  try {
    const pipeline = sharp(buffer, {
      failOn: "error",
      limitInputPixels,
      pages: 1, // Single-frame extract: neutralizes multi-frame animated GIF/WebP bombs
    })
      .rotate() // Auto-rotates based on EXIF orientation and strips orientation tag
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality,
        effort: 4,
      });

    // Sharp strips all EXIF, GPS, IPTC, and XMP metadata by default unless .withMetadata() is called.
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      format: "webp",
      mime: "image/webp",
      ext: "webp",
      width: info.width,
      height: info.height,
      size: data.length,
      info,
    };
  } catch (error) {
    throw new Error(`Image processing failed: ${error.message}`);
  }
};

export default {
  MAX_PROCESSED_DIMENSION,
  WEBP_QUALITY,
  MAX_INPUT_PIXELS,
  processProductImage,
};
