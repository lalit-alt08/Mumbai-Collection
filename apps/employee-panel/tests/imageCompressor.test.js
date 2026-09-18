import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDimensions,
  compressImage,
  MAX_COMPRESS_DIMENSION,
  BANNER_MAX_DIMENSION,
  CATEGORY_MAX_DIMENSION,
  DEFAULT_COMPRESS_QUALITY,
  MAX_FILE_SIZE_BYTES,
  RAW_IMAGE_MAX_INPUT_BYTES,
  isAcceptedImage,
} from "../src/utils/imageCompressor.js";

test("Constants: matches production requirements for products, banners, and categories", () => {
  assert.equal(MAX_COMPRESS_DIMENSION, 1600, "Product max dimension is 1600px");
  assert.equal(BANNER_MAX_DIMENSION, 1920, "Banner max dimension is 1920px");
  assert.equal(CATEGORY_MAX_DIMENSION, 1200, "Category max dimension is 1200px");
  assert.equal(DEFAULT_COMPRESS_QUALITY, 0.85);
  assert.equal(MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024, "Client max file size must be 5MB");
  assert.equal(RAW_IMAGE_MAX_INPUT_BYTES, 25 * 1024 * 1024, "Raw camera input boundary is 25MB");
});

test("isAcceptedImage: validates standard, mobile HEIC, and camera captures", () => {
  // Standard web formats
  assert.equal(isAcceptedImage({ type: "image/jpeg", name: "test.jpg" }), true);
  assert.equal(isAcceptedImage({ type: "image/png", name: "test.png" }), true);
  assert.equal(isAcceptedImage({ type: "image/webp", name: "test.webp" }), true);
  assert.equal(isAcceptedImage({ type: "image/gif", name: "test.gif" }), true);

  // iPhone camera formats (HEIC / HEIF)
  assert.equal(isAcceptedImage({ type: "image/heic", name: "IMG_0001.HEIC" }), true);
  assert.equal(isAcceptedImage({ type: "image/heif", name: "IMG_0002.HEIF" }), true);

  // iOS camera temp file with empty MIME type
  assert.equal(isAcceptedImage({ type: "", name: "captured_image.jpg" }), true);
  assert.equal(isAcceptedImage({ type: "", name: "captured_image.heic" }), true);

  // Non-images rejected
  assert.equal(isAcceptedImage({ type: "application/pdf", name: "doc.pdf" }), false);
  assert.equal(isAcceptedImage({ type: "text/plain", name: "notes.txt" }), false);
  assert.equal(isAcceptedImage(null), false);
});

test("Validation: 5MB client file size limit correctly enforces 5MB boundary", () => {
  const fileUnder5Mb = { size: 5 * 1024 * 1024 - 1 };
  const fileExact5Mb = { size: 5 * 1024 * 1024 };
  const fileOver5Mb = { size: 5 * 1024 * 1024 + 1 };
  const file10Mb = { size: 10 * 1024 * 1024 };

  assert.equal(fileUnder5Mb.size > MAX_FILE_SIZE_BYTES, false, "Files under 5MB should pass");
  assert.equal(fileExact5Mb.size > MAX_FILE_SIZE_BYTES, false, "5MB exact files should pass");
  assert.equal(fileOver5Mb.size > MAX_FILE_SIZE_BYTES, true, "Files over 5MB must be rejected");
  assert.equal(file10Mb.size > MAX_FILE_SIZE_BYTES, true, "10MB files must be rejected");
});

test("calculateDimensions: scales down landscape images maintaining aspect ratio", () => {
  const result = calculateDimensions(3200, 1600, 1600);
  assert.deepEqual(result, { width: 1600, height: 800 });

  const result3to2 = calculateDimensions(2400, 1600, 1600);
  assert.deepEqual(result3to2, { width: 1600, height: 1067 });
});

test("calculateDimensions: scales down portrait images maintaining aspect ratio", () => {
  const result = calculateDimensions(1200, 2400, 1600);
  assert.deepEqual(result, { width: 800, height: 1600 });

  const result16to9 = calculateDimensions(1080, 1920, 1600);
  assert.deepEqual(result16to9, { width: 900, height: 1600 });
});

test("calculateDimensions: scales down square images to 1600x1600", () => {
  const result = calculateDimensions(2500, 2500, 1600);
  assert.deepEqual(result, { width: 1600, height: 1600 });
});

test("calculateDimensions: preserves images with both dimensions <= 1600px without upscaling", () => {
  const resultSmall = calculateDimensions(800, 600, 1600);
  assert.deepEqual(resultSmall, { width: 800, height: 600 });

  const resultExact = calculateDimensions(1600, 1600, 1600);
  assert.deepEqual(resultExact, { width: 1600, height: 1600 });

  const resultTiny = calculateDimensions(100, 150, 1600);
  assert.deepEqual(resultTiny, { width: 100, height: 150 });
});

test("calculateDimensions: handles invalid, negative, or zero dimensions gracefully", () => {
  assert.deepEqual(calculateDimensions(0, 500), { width: 0, height: 0 });
  assert.deepEqual(calculateDimensions(-100, 200), { width: 0, height: 0 });
  assert.deepEqual(calculateDimensions(null, undefined), { width: 0, height: 0 });
  assert.deepEqual(calculateDimensions("invalid", "dimensions"), { width: 0, height: 0 });
});

test("Banner images: landscape image preserves aspect ratio and stays within 1920px", () => {
  // Typical desktop banner: 3840x1440 (8:3 / 2.67:1 ratio)
  const desktopBanner = calculateDimensions(3840, 1440, BANNER_MAX_DIMENSION);
  assert.deepEqual(desktopBanner, { width: 1920, height: 720 });
  assert.equal(desktopBanner.width <= 1920, true);
  assert.equal(desktopBanner.height <= 1920, true);
  assert.equal((desktopBanner.width / desktopBanner.height).toFixed(3), (3840 / 1440).toFixed(3));

  // Ultrawide banner: 2560x1080 (21:9 ratio)
  const ultrawideBanner = calculateDimensions(2560, 1080, BANNER_MAX_DIMENSION);
  assert.deepEqual(ultrawideBanner, { width: 1920, height: 810 });
  assert.equal(ultrawideBanner.width, 1920);

  // High-res mobile banner: 2160x947 (16:7 / 2.28:1 ratio)
  const mobileBanner = calculateDimensions(2160, 947, BANNER_MAX_DIMENSION);
  assert.deepEqual(mobileBanner, { width: 1920, height: 842 });
});

test("Banner images: compressImage end-to-end stays within 1920px and preserves aspect ratio", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFile = globalThis.File;

  try {
    let canvasWidth = 0;
    let canvasHeight = 0;

    globalThis.createImageBitmap = async () => ({
      width: 3840,
      height: 1440,
      close: () => {},
    });

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "canvas") {
          return {
            set width(val) { canvasWidth = val; },
            get width() { return canvasWidth; },
            set height(val) { canvasHeight = val; },
            get height() { return canvasHeight; },
            getContext: () => ({
              drawImage: () => {},
            }),
            toBlob: (cb, mimeType) => {
              const blob = new Blob(["mock-banner-webp"], { type: mimeType });
              cb(blob);
            },
          };
        }
        return {};
      },
    };

    const inputBlob = new Blob(["mock-jpeg-data"], { type: "image/jpeg" });
    inputBlob.name = "store_hero_banner.jpg";

    const compressed = await compressImage(inputBlob, { maxDimension: BANNER_MAX_DIMENSION });

    assert.equal(canvasWidth, 1920);
    assert.equal(canvasHeight, 720);
    assert.equal(compressed.type, "image/webp");
    assert.equal(compressed.name, "store_hero_banner.webp");
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.File = originalFile;
  }
});

test("Category images: preserves aspect ratio and stays within 1200px", () => {
  // Landscape category image: 2400x1600 (3:2 ratio)
  const landscapeCat = calculateDimensions(2400, 1600, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(landscapeCat, { width: 1200, height: 800 });
  assert.equal(landscapeCat.width <= 1200, true);
  assert.equal(landscapeCat.height <= 1200, true);
  assert.equal((landscapeCat.width / landscapeCat.height).toFixed(3), (2400 / 1600).toFixed(3));

  // Portrait category image: 1500x2000 (3:4 ratio)
  const portraitCat = calculateDimensions(1500, 2000, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(portraitCat, { width: 900, height: 1200 });
  assert.equal(portraitCat.height, 1200);
  assert.equal((portraitCat.width / portraitCat.height).toFixed(3), (1500 / 2000).toFixed(3));

  // Square category image: 1800x1800
  const squareCat = calculateDimensions(1800, 1800, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(squareCat, { width: 1200, height: 1200 });
});

test("Category images: compressImage end-to-end stays within 1200px and preserves aspect ratio", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFile = globalThis.File;

  try {
    let canvasWidth = 0;
    let canvasHeight = 0;

    globalThis.createImageBitmap = async () => ({
      width: 2400,
      height: 1600,
      close: () => {},
    });

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "canvas") {
          return {
            set width(val) { canvasWidth = val; },
            get width() { return canvasWidth; },
            set height(val) { canvasHeight = val; },
            get height() { return canvasHeight; },
            getContext: () => ({
              drawImage: () => {},
            }),
            toBlob: (cb, mimeType) => {
              const blob = new Blob(["mock-category-webp"], { type: mimeType });
              cb(blob);
            },
          };
        }
        return {};
      },
    };

    const inputBlob = new Blob(["mock-png-data"], { type: "image/png" });
    inputBlob.name = "fashion_category.png";

    const compressed = await compressImage(inputBlob, { maxDimension: CATEGORY_MAX_DIMENSION });

    assert.equal(canvasWidth, 1200);
    assert.equal(canvasHeight, 800);
    assert.equal(compressed.type, "image/webp");
    assert.equal(compressed.name, "fashion_category.webp");
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.File = originalFile;
  }
});

test("No upscaling: images already below the relevant limit are not upscaled", () => {
  // Below banner limit (1920px)
  const bannerBelow = calculateDimensions(1600, 600, BANNER_MAX_DIMENSION);
  assert.deepEqual(bannerBelow, { width: 1600, height: 600 });

  const bannerExact = calculateDimensions(1920, 720, BANNER_MAX_DIMENSION);
  assert.deepEqual(bannerExact, { width: 1920, height: 720 });

  // Below category limit (1200px)
  const catBelow = calculateDimensions(800, 600, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(catBelow, { width: 800, height: 600 });

  const catExact = calculateDimensions(1200, 800, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(catExact, { width: 1200, height: 800 });

  // Small square image below limits
  const smallSquareBanner = calculateDimensions(400, 400, BANNER_MAX_DIMENSION);
  assert.deepEqual(smallSquareBanner, { width: 400, height: 400 });

  const smallSquareCat = calculateDimensions(400, 400, CATEGORY_MAX_DIMENSION);
  assert.deepEqual(smallSquareCat, { width: 400, height: 400 });
});

test("compressImage: returns original file when environment does not have DOM/canvas", async () => {
  const mockFile = new Blob(["fake image data"], { type: "image/jpeg" });
  mockFile.name = "test.jpg";

  const result = await compressImage(mockFile);
  assert.equal(result, mockFile, "Should return original file when DOM is unavailable");
});

test("compressImage: prefers WebP at quality 0.85 when supported", async () => {
  // Create a minimal browser DOM mock
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFile = globalThis.File;

  try {
    let toBlobCalls = [];

    globalThis.createImageBitmap = async () => ({
      width: 3200,
      height: 1600,
      close: () => {},
    });

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: () => {},
              fillRect: () => {},
              fillStyle: "",
            }),
            toBlob: (cb, mimeType, quality) => {
              toBlobCalls.push({ mimeType, quality });
              const blob = new Blob(["mock-webp-data"], { type: "image/webp" });
              cb(blob);
            },
          };
        }
        return {};
      },
    };

    const inputBlob = new Blob(["mock-jpeg-data"], { type: "image/jpeg" });
    inputBlob.name = "product_camera.jpg";

    const compressed = await compressImage(inputBlob);

    // Verify WebP was attempted first with quality 0.85
    assert.ok(toBlobCalls.length >= 1);
    assert.equal(toBlobCalls[0].mimeType, "image/webp");
    assert.equal(toBlobCalls[0].quality, 0.85);

    // Verify resulting file properties
    assert.equal(compressed.type, "image/webp");
    assert.equal(compressed.name, "product_camera.webp");
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.File = originalFile;
  }
});

test("compressImage: falls back to JPEG at quality 0.85 if WebP export is unsupported without reusing closed ImageBitmap", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFile = globalThis.File;

  try {
    let toBlobCalls = [];
    let isBitmapClosed = false;
    let drawCallCount = 0;

    globalThis.createImageBitmap = async () => ({
      width: 2000,
      height: 1000,
      close: () => {
        isBitmapClosed = true;
      },
    });

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: () => {
                if (isBitmapClosed) {
                  throw new Error("InvalidStateError: The ImageBitmap object is detached/closed.");
                }
                drawCallCount++;
              },
              fillRect: () => {},
              fillStyle: "",
            }),
            toBlob: (cb, mimeType, quality) => {
              toBlobCalls.push({ mimeType, quality });
              if (mimeType === "image/webp") {
                // Simulate browser that does not support WebP canvas export
                cb(null);
              } else if (mimeType === "image/jpeg") {
                // Fallback succeeds
                const blob = new Blob(["mock-jpeg-data"], { type: "image/jpeg" });
                cb(blob);
              }
            },
          };
        }
        return {};
      },
    };

    const inputBlob = new Blob(["mock-png-data"], { type: "image/png" });
    inputBlob.name = "shelf_item.png";

    const compressed = await compressImage(inputBlob);

    // Verify WebP was attempted first, then JPEG fallback
    assert.equal(toBlobCalls[0].mimeType, "image/webp");
    assert.equal(toBlobCalls[0].quality, 0.85);
    assert.equal(toBlobCalls[1].mimeType, "image/jpeg");
    assert.equal(toBlobCalls[1].quality, 0.85);

    // Verify both draws succeeded without detached ImageBitmap errors
    assert.equal(drawCallCount, 2, "Both WebP and JPEG fallback should have drawn from open bitmap");

    // Verify bitmap was closed in finally after compression completed
    assert.equal(isBitmapClosed, true, "ImageBitmap must be closed on completion");

    // Verify resulting fallback file properties
    assert.equal(compressed.type, "image/jpeg");
    assert.equal(compressed.name, "shelf_item.jpg");
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.File = originalFile;
  }
});

test("compressImage: gracefully falls back to original file on error", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  try {
    globalThis.createImageBitmap = async () => {
      throw new Error("Simulated corrupt image bitmap failure");
    };
    globalThis.document = {
      createElement: () => ({
        getContext: () => null, // context unavailable
      }),
    };

    const inputBlob = new Blob(["corrupt-data"], { type: "image/jpeg" });
    inputBlob.name = "corrupt.jpg";

    const result = await compressImage(inputBlob);
    assert.equal(result, inputBlob, "Must return original file on compression error");
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});
