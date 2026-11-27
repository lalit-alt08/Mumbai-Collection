import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createBannerVideoRetryManager,
  MAX_VIDEO_RETRIES,
  getRetryBackoffMs,
} from "../src/utils/bannerVideoRetry.js";

test("Banner Video Retry Manager Suite", async (t) => {
  await t.test("1. Exponential backoff intervals are properly calculated", () => {
    assert.equal(getRetryBackoffMs(1), 3000);
    assert.equal(getRetryBackoffMs(2), 4500);
    assert.equal(getRetryBackoffMs(3), 6750);
    assert.equal(getRetryBackoffMs(10), 12000, "Must cap at 12000ms");
  });

  await t.test("2. Dangling timer fix: reset() clears timeout and sets timeoutId to null", () => {
    let retried = false;
    const manager = createBannerVideoRetryManager({
      onScheduleRetry: () => { retried = true; },
    });

    // 1st failure on initial banner
    const scheduled = manager.handleFailure({ reason: "error_1", epoch: 0 });
    assert.equal(scheduled, true);
    assert.notEqual(manager.getTimeoutId(), null, "Timeout ID must be active");
    assert.equal(manager.getRetryCount(), 1);

    // Banner changes -> reset() called
    manager.reset();
    assert.equal(manager.getTimeoutId(), null, "Timeout ID must be reset to null");
    assert.equal(manager.getRetryCount(), 0, "Retry count must reset to 0");
    assert.equal(manager.getPlaybackEpoch(), 1, "Playback epoch must advance");

    // Subsequent failure on the new banner must schedule cleanly (not blocked by dangling timer)
    const newScheduled = manager.handleFailure({ reason: "error_new_banner", epoch: 1 });
    assert.equal(newScheduled, true, "New video failure must schedule retry without being blocked by old timer");
    assert.equal(manager.getRetryCount(), 1);
    assert.notEqual(manager.getTimeoutId(), null);

    manager.dispose();
  });

  await t.test("3. Dual near-simultaneous errors (.play() rejection + onError) are deduplicated into exactly 1 retry", () => {
    const manager = createBannerVideoRetryManager();

    // 1st event: .play() rejection
    const firstScheduled = manager.handleFailure({ reason: "play_rejection", epoch: 0 });
    assert.equal(firstScheduled, true);
    assert.equal(manager.getRetryCount(), 1);

    // 2nd event (5ms later): DOM onError event for the same failure cycle
    const secondScheduled = manager.handleFailure({ reason: "media_onError", epoch: 0 });
    assert.equal(secondScheduled, false, "Second near-simultaneous error must not schedule duplicate retry");
    assert.equal(manager.getRetryCount(), 1, "Retry count must not double-increment");

    manager.dispose();
  });

  await t.test("4. Late error from superseded playback epoch is safely ignored", () => {
    const manager = createBannerVideoRetryManager();
    assert.equal(manager.getPlaybackEpoch(), 0);

    // Banner changes or user reconnects -> epoch advances
    manager.reset();
    assert.equal(manager.getPlaybackEpoch(), 1);

    // An old delayed promise rejection arrives referencing epoch 0
    const lateScheduled = manager.handleFailure({ reason: "late_rejection_from_old_video", epoch: 0 });
    assert.equal(lateScheduled, false, "Late error from older epoch must be rejected");
    assert.equal(manager.getRetryCount(), 0, "Late error must not alter retry counter");

    manager.dispose();
  });

  await t.test("5. Automatic retries stop strictly after MAX_VIDEO_RETRIES", () => {
    const manager = createBannerVideoRetryManager();

    // Consume all 3 retries
    for (let i = 1; i <= MAX_VIDEO_RETRIES; i++) {
      assert.equal(manager.handleFailure({ reason: `failure_${i}`, epoch: 0 }), true);
      assert.equal(manager.getRetryCount(), i);
      // Simulate timer completion
      manager.dispose();
    }

    // 4th failure after budget exhausted
    const overBudgetScheduled = manager.handleFailure({ reason: "failure_4", epoch: 0 });
    assert.equal(overBudgetScheduled, false, "Must not schedule retry once MAX_VIDEO_RETRIES is exhausted");
    assert.equal(manager.getRetryCount(), MAX_VIDEO_RETRIES);

    manager.dispose();
  });

  await t.test("6. handleSuccess clears timers and resets failure counter", () => {
    const manager = createBannerVideoRetryManager();

    manager.handleFailure({ reason: "temp_glitch", epoch: 0 });
    assert.equal(manager.getRetryCount(), 1);
    assert.notEqual(manager.getTimeoutId(), null);

    // Video begins playing (onPlaying event)
    manager.handleSuccess();
    assert.equal(manager.getRetryCount(), 0);
    assert.equal(manager.getTimeoutId(), null);

    manager.dispose();
  });

  await t.test("7. Early /api/banners bootstrap avoids duplicate fetch and MobileThinBanner defers video mount", async () => {
    const { getBanners, _setCatalogClientForTesting } = await import("../src/services/productService.js");
    const prevWindow = globalThis.window;
    let networkCalls = 0;
    try {
      const earlyPayload = {
        success: true,
        banners: [{ id: "hero-1", desktop_image: "/api/media/uploads/h.webp?v=1", is_active: true }],
        thin_banner: { id: "thin-1", image: "/banners/welcome-thin-banner.webp", is_active: true },
      };
      globalThis.window = { __MUMBAI_EARLY_BANNERS__: Promise.resolve(earlyPayload) };
      _setCatalogClientForTesting({
        async get() {
          networkCalls += 1;
          return { data: earlyPayload };
        },
      });
      const result = await getBanners();
      assert.deepEqual(result, earlyPayload);
      assert.equal(networkCalls, 0, "getBanners must reuse early head fetch when available");
    } finally {
      globalThis.window = prevWindow;
    }

    const thinBannerSrc = readFileSync(
      new URL("../src/components/home/MobileThinBanner.jsx", import.meta.url),
      "utf8"
    );
    assert.match(thinBannerSrc, /isDeferredVideoReady/, "MobileThinBanner must defer MP4 attachment until post-load/interaction");
    assert.match(thinBannerSrc, /prefers-reduced-motion:\s*reduce/, "MobileThinBanner must respect reduced-motion");

    const indexHtmlSrc = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(indexHtmlSrc, /__MUMBAI_EARLY_BANNERS__/, "index.html must start /api/banners early on /");
    assert.match(indexHtmlSrc, /AbortController/, "index.html early fetch must have an abort timeout");
    assert.match(
      indexHtmlSrc,
      /media_type === "video" && b\.video_url/,
      "index.html must match HeroBanner slide eligibility before choosing image preload"
    );
    assert.ok(
      indexHtmlSrc.indexOf("__MUMBAI_EARLY_BANNERS__") < indexHtmlSrc.indexOf("fonts.googleapis.com/css2"),
      "early banner bootstrap must run before the render-blocking Google Fonts stylesheet"
    );
  });
});
