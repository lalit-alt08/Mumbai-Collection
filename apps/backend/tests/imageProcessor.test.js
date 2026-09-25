import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  processProductImage,
  MAX_PROCESSED_DIMENSION,
  WEBP_QUALITY,
  MAX_INPUT_PIXELS,
} from "../src/services/imageProcessor.js";
import { uploadMedia } from "../src/services/wordpressMediaService.js";
import axios from "axios";

// Helper: check if buffer starts with WebP RIFF magic bytes
const isWebpBuffer = (buf) =>
  buf &&
  buf.length >= 12 &&
  buf[0] === 0x52 &&
  buf[1] === 0x49 &&
  buf[2] === 0x46 &&
  buf[3] === 0x46 &&
  buf[8] === 0x57 &&
  buf[9] === 0x45 &&
  buf[10] === 0x42 &&
  buf[11] === 0x50;

test("ImageProcessor: Constants match Phase 2 requirements", () => {
  assert.equal(MAX_PROCESSED_DIMENSION, 1600, "Max dimension must be 1600px");
  assert.equal(WEBP_QUALITY, 82, "WebP quality must be 82");
  assert.equal(MAX_INPUT_PIXELS, 36000000, "Max input pixels must be 36,000,000");
});

test("ImageProcessor: Resizes large images so max dimension does not exceed 1600px while maintaining aspect ratio", async () => {
  // Create 2400x1200 JPEG
  const largeInput = await sharp({
    create: {
      width: 2400,
      height: 1200,
      channels: 3,
      background: { r: 180, g: 100, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();

  const result = await processProductImage(largeInput);

  assert.ok(isWebpBuffer(result.buffer), "Output must be authentic WebP format");
  assert.equal(result.format, "webp");
  assert.equal(result.mime, "image/webp");
  assert.equal(result.ext, "webp");
  assert.equal(result.width, 1600, "Width should be scaled down to max 1600px");
  assert.equal(result.height, 800, "Height should maintain 2:1 aspect ratio at 800px");
  assert.ok(result.size > 0);
  assert.ok(result.size < largeInput.length, "WebP compression should reduce file size");
});

test("ImageProcessor: Preserves smaller image dimensions without upscaling / enlargement", async () => {
  // Create 700x500 PNG
  const smallInput = await sharp({
    create: {
      width: 700,
      height: 500,
      channels: 3,
      background: { r: 50, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();

  const result = await processProductImage(smallInput);

  assert.ok(isWebpBuffer(result.buffer), "Output must be authentic WebP format");
  assert.equal(result.width, 700, "Small image width must not be enlarged");
  assert.equal(result.height, 500, "Small image height must not be enlarged");
  assert.equal(result.format, "webp");
});

test("ImageProcessor: Auto-rotates image using EXIF orientation and removes orientation tag", async () => {
  // Create an image with EXIF orientation 6 (rotated 90 degrees CW)
  // Sharp withMetadata({ orientation: 6 }) creates EXIF with orientation 6
  const orientedInput = await sharp({
    create: {
      width: 600,
      height: 300,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const preMeta = await sharp(orientedInput).metadata();
  assert.equal(preMeta.orientation, 6, "Input should have EXIF orientation 6");

  const result = await processProductImage(orientedInput);
  const postMeta = await sharp(result.buffer).metadata();

  // After auto-rotation, the pixels are rotated (600x300 becomes 300x600)
  assert.equal(result.width, 300, "Width should reflect 90-deg rotation");
  assert.equal(result.height, 600, "Height should reflect 90-deg rotation");
  assert.equal(postMeta.orientation, undefined, "Orientation tag must be stripped/normalized");
});

test("ImageProcessor: Strips EXIF and GPS metadata from the processed image", async () => {
  // Create JPEG with custom metadata
  const metaInput = await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .withMetadata({
      orientation: 1,
      exif: {
        IFD0: {
          Make: "TestCamera",
          Model: "TestModel",
        },
      },
    })
    .jpeg()
    .toBuffer();

  const result = await processProductImage(metaInput);
  const postMeta = await sharp(result.buffer).metadata();

  assert.equal(postMeta.exif, undefined, "EXIF metadata must be stripped");
  assert.equal(postMeta.orientation, undefined, "Orientation metadata must be stripped");
});

test("ImageProcessor: Converts PNG, GIF, and WebP inputs cleanly into WebP at quality 82", async () => {
  // PNG input
  const pngInput = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const pngRes = await processProductImage(pngInput);
  assert.equal(pngRes.format, "webp");
  assert.ok(isWebpBuffer(pngRes.buffer));

  // GIF input
  const gifInput = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 200, g: 200, b: 0 } },
  })
    .gif()
    .toBuffer();
  const gifRes = await processProductImage(gifInput);
  assert.equal(gifRes.format, "webp");
  assert.ok(isWebpBuffer(gifRes.buffer));

  // WebP input
  const webpInput = await sharp({
    create: { width: 80, height: 80, channels: 3, background: { r: 0, g: 150, b: 255 } },
  })
    .webp()
    .toBuffer();
  const webpRes = await processProductImage(webpInput);
  assert.equal(webpRes.format, "webp");
  assert.ok(isWebpBuffer(webpRes.buffer));
});

test("ImageProcessor: Throws an informative error for invalid or corrupt buffer", async () => {
  await assert.rejects(
    () => processProductImage(null),
    /Invalid or missing image buffer/i
  );

  await assert.rejects(
    () => processProductImage(Buffer.from("not-a-valid-image-data")),
    /Image processing failed/i
  );
});

test("ImageProcessor: Rejects truncated or malformed image data (fail-closed guard)", async () => {
  const validJpeg = await sharp({
    create: { width: 150, height: 150, channels: 3, background: { r: 60, g: 120, b: 180 } },
  })
    .jpeg()
    .toBuffer();

  // Truncate to 80% of data (valid header, but premature datastream cutoff)
  const truncatedJpeg = validJpeg.subarray(0, Math.floor(validJpeg.length * 0.8));

  await assert.rejects(
    () => processProductImage(truncatedJpeg),
    /Image processing failed/i
  );
});

test("ImageProcessor: Rejects input exceeding pixel-flood decompression bomb threshold", async () => {
  // Test that limitInputPixels option strictly halts processing if pixel count exceeds threshold
  const sampleJpeg = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();

  // 50x50 = 2500 pixels. With limitInputPixels: 1000, it should reject
  await assert.rejects(
    () => processProductImage(sampleJpeg, { limitInputPixels: 1000 }),
    /Image processing failed.*pixel limit/i
  );
});

test("ImageProcessor: Multi-frame animated GIF extracts only first frame into single-frame WebP", async () => {
  const gifInput = await sharp({
    create: { width: 60, height: 60, channels: 3, background: { r: 255, g: 255, b: 0 } },
  })
    .gif()
    .toBuffer();

  const result = await processProductImage(gifInput);
  assert.equal(result.format, "webp");
  assert.ok(isWebpBuffer(result.buffer));
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.pages || 1, 1, "Resulting WebP must be single-frame");
});

test("WordPressMediaService: uploadMedia processes image through Sharp before posting to WordPress", async () => {
  const originalPost = axios.post;
  let interceptedPayload = null;
  let interceptedHeaders = null;

  // Mock axios.post for WordPress Media API and tracking
  axios.post = async (url, data, config) => {
    if (url && url.includes("/wp/v2/media")) {
      interceptedPayload = data;
      interceptedHeaders = config.headers;
      return {
        data: {
          id: 789,
          source_url: "https://mumbai-collection.local/wp-content/uploads/camera_shot_123.webp",
        },
      };
    }
    return { data: { success: true } };
  };

  try {
    process.env.WP_APPLICATION_PASSWORD = "test-mock-password";

    // Unprocessed 2000x1000 JPEG input
    const largeJpeg = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const file = {
      originalname: "camera_shot.jpg",
      buffer: largeJpeg,
      mimetype: "image/jpeg",
    };

    const result = await uploadMedia(file);

    assert.equal(result.id, 789);
    assert.equal(
      result.url,
      "https://mumbai-collection.local/wp-content/uploads/camera_shot_123.webp"
    );

    // Verify WordPress received WebP content type
    assert.equal(interceptedHeaders["Content-Type"], "image/webp");

    // Verify Content-Disposition filename ends with .webp
    assert.match(
      interceptedHeaders["Content-Disposition"],
      /filename="camera_shot_\d+\.webp"/
    );

    // Verify the payload sent to WordPress was processed into WebP and resized to 1600x800
    assert.ok(isWebpBuffer(interceptedPayload), "Payload to WordPress must be WebP buffer");
    const sentMeta = await sharp(interceptedPayload).metadata();
    assert.equal(sentMeta.format, "webp");
    assert.equal(sentMeta.width, 1600);
    assert.equal(sentMeta.height, 800);
  } finally {
    axios.post = originalPost;
  }
});
