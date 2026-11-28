import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

test("Banner Concurrency & Version Integrity Suite", async (t) => {
  const { getEmployeeBanners, getPublicBanners, updateEmployeeBanners } = await import("../src/controllers/bannerController.js");
  const { getBanners, saveBanners } = await import("../src/services/bannerService.js");

  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;

  t.afterEach(() => {
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
  });

  await t.test("1. getEmployeeBanners includes authoritative version in JSON response", async () => {
    axios.get = async () => ({
      data: {
        success: true,
        banners: [
          { id: "banner-1", title: "Festival Sale", desktop_image: "/fest.jpg", is_active: true }
        ],
        thin_banner: { id: "thin-1", title: "Notice", is_active: true },
        version: 7,
      },
    });

    let statusCode = 200;
    let jsonBody = null;
    const req = {
      protocol: "https",
      get: () => "localhost",
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        jsonBody = data;
        return res;
      },
    };

    await getEmployeeBanners(req, res);

    assert.equal(statusCode, 200);
    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.version, 7, "getEmployeeBanners must return version in response");
    assert.equal(jsonBody.banners.length, 1);
  });

  await t.test("2. saveBanners strictly requires expected_version and rejects missing or non-finite version", async () => {
    await assert.rejects(
      async () => {
        await saveBanners({
          banners: [{ id: "b1", title: "Sale", desktop_image: "/img.jpg", is_active: true }],
          // expected_version omitted
        });
      },
      /expected_version is required/,
      "saveBanners must reject calls lacking expected_version"
    );

    await assert.rejects(
      async () => {
        await saveBanners({
          banners: [{ id: "b1", title: "Sale", desktop_image: "/img.jpg", is_active: true }],
          expected_version: "invalid",
        });
      },
      /expected_version is required/,
      "saveBanners must reject non-numeric expected_version"
    );
  });

  await t.test("3. saveBanners fails safely if WordPress response omits version (no fabricated version)", async () => {
    axios.post = async () => ({
      data: {
        success: true,
        banners: [{ id: "b1", title: "Sale", desktop_image: "/img.jpg", is_active: true }],
        // version omitted from response
      },
    });

    await assert.rejects(
      async () => {
        await saveBanners({
          banners: [{ id: "b1", title: "Sale", desktop_image: "/img.jpg", is_active: true }],
          expected_version: 5,
        });
      },
      /WordPress failed to confirm the updated banner version/,
      "saveBanners must fail closed if WordPress omits version rather than inventing one"
    );
  });

  await t.test("4. updateBanners maps WordPress 409 conflict to BANNER_CONFLICT status 409", async () => {
    axios.post = async () => {
      const err = new Error("Banner conflict");
      err.response = {
        status: 409,
        data: {
          code: "banner_conflict",
          message: "Another staff member updated the banners while you were editing.",
          data: { current_version: 12 },
        },
      };
      throw err;
    };

    let statusCode = 200;
    let jsonBody = null;
    const req = {
      body: {
        banners: [{ id: "b1", title: "Test", desktop_image: "/test.jpg", is_active: true }],
        expected_version: 10,
      },
      protocol: "https",
      get: () => "localhost",
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        jsonBody = data;
        return res;
      },
    };

    await updateEmployeeBanners(req, res);

    assert.equal(statusCode, 409, "Must return HTTP 409 on version conflict");
    assert.equal(jsonBody.success, false);
    assert.equal(jsonBody.code, "BANNER_CONFLICT");
    assert.match(jsonBody.message, /Another staff member updated/);
  });

  await t.test("5. WordPress plugin (mumbai-auth.php) enforces atomic snapshot and verified persistence", () => {
    const phpSource = fs.readFileSync(
      new URL("../../wordpress-plugin/mumbai-auth.php", import.meta.url),
      "utf8"
    );

    // Verify GET_LOCK in mumbai_get_banners and fail-closed lock_timeout
    assert.match(
      phpSource,
      /function mumbai_get_banners\(\)[\s\S]*?GET_LOCK\(%s,\s*2\)[\s\S]*?!\$locked[\s\S]*?'lock_timeout'[\s\S]*?'status'\s*=>\s*503/,
      "mumbai_get_banners must acquire GET_LOCK and return 503 lock_timeout if lock cannot be acquired"
    );

    // Verify atomic bundle read
    assert.match(
      phpSource,
      /get_option\('mumbai_banners_bundle',\s*null\)/,
      "mumbai_get_banners must read single atomic mumbai_banners_bundle option"
    );

    // Verify expected_version is required in mumbai_save_banners
    assert.match(
      phpSource,
      /\$expected_version === null[\s\S]*?missing_version/,
      "mumbai_save_banners must require expected_version and return missing_version on null"
    );

    // Verify conflict check returns 409
    assert.match(
      phpSource,
      /\$expected_version !== \$current_version[\s\S]*?banner_conflict[\s\S]*?'status'\s*=>\s*409/,
      "mumbai_save_banners must return 409 banner_conflict on version mismatch"
    );

    // Verify atomic transaction wrapping writes with checked start and commit
    assert.match(
      phpSource,
      /\$wpdb->query\('START TRANSACTION'\)\s*===\s*false[\s\S]*?'transaction_start_failed'[\s\S]*?\$wpdb->query\('COMMIT'\)\s*===\s*false[\s\S]*?'transaction_commit_failed'/,
      "mumbai_save_banners must check return values of START TRANSACTION and COMMIT"
    );

    // Verify cache purge on rollback
    assert.match(
      phpSource,
      /\$purge_banner_caches\s*=\s*function[\s\S]*?wp_cache_delete[\s\S]*?clean_post_cache[\s\S]*?\$purge_banner_caches\(\)/,
      "mumbai_save_banners must purge option and attachment caches on failure or rollback"
    );

    // Verify post-commit direct database query verification
    assert.match(
      phpSource,
      /SELECT option_value FROM {\$wpdb->options} WHERE option_name\s*=[\s\S]*?version_verification_failed/,
      "mumbai_save_banners must verify updated version persistence directly against options table after commit"
    );
  });

  await t.test("6. getBanners(true) bypasses 5-second cooldown for immediate staff conflict reload", async () => {
    let callCount = 0;
    axios.get = async () => {
      callCount++;
      return {
        data: {
          success: true,
          banners: [{ id: "b1", title: `Call ${callCount}`, desktop_image: "/img.jpg", is_active: true }],
          thin_banner: { id: "thin-1", title: "Notice", is_active: true },
          version: callCount,
        },
      };
    };

    // First forced fetch
    const first = await getBanners(true);
    assert.equal(first.version, 1);
    assert.equal(callCount, 1);

    // Second forced fetch immediately afterwards (0ms gap, well within 5000ms cooldown)
    const second = await getBanners(true);
    assert.equal(second.version, 2, "Force fresh fetch must not be throttled by 5-second cooldown");
    assert.equal(callCount, 2);
  });

  await t.test("7. getBanners(true) strictly fails closed when WordPress is unreachable (never returns cached fallback)", async () => {
    axios.get = async () => {
      const err = new Error("Connection refused to WordPress");
      err.code = "ECONNREFUSED";
      throw err;
    };

    await assert.rejects(
      async () => {
        await getBanners(true);
      },
      /Connection refused to WordPress/,
      "Staff forced read must fail closed on network error rather than returning cached fallback"
    );
  });

  await t.test("8. getBanners(true) strictly fails closed when WordPress omits version (never fabricates version 1)", async () => {
    axios.get = async () => ({
      data: {
        success: true,
        banners: [{ id: "b1", title: "Test", desktop_image: "/img.jpg", is_active: true }],
        thin_banner: { id: "thin-1", title: "Notice", is_active: true },
        // version omitted
      },
    });

    await assert.rejects(
      async () => {
        await getBanners(true);
      },
      /WordPress failed to return an authoritative banner version/,
      "Staff forced read must reject response without version instead of defaulting to 1"
    );
  });

  await t.test("public refresh parameters cannot bypass a fresh shared cache", async () => {
    let reads = 0;
    axios.get = async () => {
      reads++;
      return { data: { banners: [], thin_banner: { is_active: false }, version: 15 } };
    };
    await getBanners(true);
    const res = { json() { return this; }, status() { return this; } };
    for (let i = 0; i < 3; i++) {
      await getPublicBanners({ query: { force: "true", _t: String(i) }, protocol: "https", get: () => "localhost" }, res);
    }
    assert.equal(reads, 1);
  });

  await t.test("a forced staff read racing a completed save fails closed", async () => {
    let resolveRead;
    axios.get = () => new Promise((resolve) => { resolveRead = resolve; });
    axios.post = async () => ({ data: { success: true, banners: [], version: 22 } });
    const read = getBanners(true);
    await saveBanners({ banners: [], expected_version: 21 });
    resolveRead({ data: { banners: [], version: 21 } });
    await assert.rejects(read, /changed during the read/);
  });

  await t.test("9. media proxy handles OPTIONS CORS preflight and conditionally advertises Accept-Ranges only on 206/verified upstream", async () => {
    const { default: mediaRouter } = await import("../src/routes/mediaRoutes.js");

    // 1. Test OPTIONS preflight
    let preflightHeaders = {};
    let preflightStatus = null;
    let preflightEnded = false;
    const reqOptions = {
      method: "OPTIONS",
      url: "/uploads/2026/11/video.mp4",
      path: "/uploads/2026/11/video.mp4",
    };
    const resOptions = {
      setHeader: (k, v) => { preflightHeaders[k.toLowerCase()] = v; },
      status: (c) => { preflightStatus = c; return { end: () => { preflightEnded = true; } }; },
      end: () => { preflightEnded = true; },
    };

    await mediaRouter.handle(reqOptions, resOptions, () => {});
    assert.equal(preflightStatus, 204, "OPTIONS preflight must respond 204");
    assert.equal(preflightHeaders["access-control-allow-origin"], "*");
    assert.match(preflightHeaders["access-control-allow-methods"], /GET, HEAD, OPTIONS/);
    assert.match(preflightHeaders["access-control-allow-headers"], /Range/);
    assert.match(preflightHeaders["access-control-expose-headers"], /Content-Range, Accept-Ranges/);

    // Test OPTIONS preflight passed!
    // Now verify header logic in mediaRoutes:
    // When upstream returns 206, Accept-Ranges: bytes is set.
    // When upstream returns 200, Accept-Ranges is only set if upstream sent it.
    const mediaRoutesSource = fs.readFileSync(new URL("../src/routes/mediaRoutes.js", import.meta.url), "utf8");
    assert.match(
      mediaRoutesSource,
      /req\.method === "OPTIONS"/,
      "mediaRoutes must handle OPTIONS preflight"
    );
    assert.match(
      mediaRoutesSource,
      /res\.setHeader\("Access-Control-Allow-Origin", "\*"\)/,
      "mediaRoutes must allow cross-origin requests"
    );
    assert.match(
      mediaRoutesSource,
      /res\.setHeader\("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, ETag"\)/,
      "mediaRoutes must expose Content-Range and Accept-Ranges headers to browser"
    );
    assert.match(
      mediaRoutesSource,
      /if \(response\.status === 206 \|\| response\.headers\["accept-ranges"\]\)/,
      "mediaRoutes must only advertise Accept-Ranges when upstream actually returns 206 or explicit accept-ranges"
    );
  });

  await t.test("10. All 3 hero carousel banners support video mode, validation, and cache-busted public URLs", async () => {
    // A. Reject active hero video banner without poster image
    let statusCode = 200;
    let jsonBody = null;
    const makeRes = () => ({
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
    });

    await updateEmployeeBanners(
      {
        body: {
          expected_version: 1,
          banners: [
            {
              id: "hero-1",
              title: "Slide 1",
              media_type: "video",
              video_media_id: 501,
              video_url: "/wp-content/uploads/2026/11/s1.mp4",
              is_active: true,
            },
          ],
        },
        protocol: "https",
        get: () => "localhost",
      },
      makeRes()
    );
    assert.equal(statusCode, 400);
    assert.match(jsonBody.message, /poster image/i);

    // B. Save all 3 hero slides with video mode + posters
    const threeVideoSlides = [1, 2, 3].map((n) => ({
      id: `hero-${n}`,
      title: `Video Slide ${n}`,
      link: `/category/slide-${n}`,
      desktop_image: `https://mumbai-collection.local/wp-content/uploads/2026/11/poster-${n}.jpg`,
      desktop_media_id: 400 + n,
      mobile_image: "",
      mobile_media_id: null,
      media_type: "video",
      video_url: `https://mumbai-collection.local/wp-content/uploads/2026/11/slide-${n}.mp4`,
      video_media_id: 500 + n,
      is_active: true,
    }));

    axios.post = async (_url, payload) => {
      assert.equal(payload.banners.length, 3);
      for (let i = 0; i < 3; i++) {
        assert.equal(payload.banners[i].media_type, "video");
        assert.equal(payload.banners[i].video_media_id, 501 + i);
      }
      return {
        data: {
          success: true,
          banners: payload.banners,
          thin_banner: { id: "thin-1", is_active: false },
          version: 21,
        },
      };
    };

    statusCode = 200;
    jsonBody = null;
    await updateEmployeeBanners(
      {
        body: { expected_version: 20, banners: threeVideoSlides },
        protocol: "https",
        get: () => "localhost",
      },
      makeRes()
    );
    assert.equal(statusCode, 200);
    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.banners.length, 3);

    // C. Public banners expose all 3 video slides with cache-busted video URLs
    statusCode = 200;
    jsonBody = null;
    await getPublicBanners({ protocol: "https", get: () => "localhost" }, makeRes());
    assert.equal(statusCode, 200);
    assert.equal(jsonBody.banners.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(jsonBody.banners[i].media_type, "video");
      assert.equal(new URL(jsonBody.banners[i].video_url).searchParams.get("v"), `${501 + i}-21`);
    }

    // D. WordPress plugin protects hero banner video_media_id from orphan cleanup
    const phpSource = fs.readFileSync(
      new URL("../../wordpress-plugin/mumbai-auth.php", import.meta.url),
      "utf8"
    );
    assert.match(
      phpSource,
      /\$desktop_id === \$media_id \|\| \$mobile_id === \$media_id \|\| \$video_id === \$media_id/,
      "mumbai_is_media_referenced must protect hero banner video_media_id from orphan cleanup"
    );
  });

  await t.test("public refresh revalidates after the cooldown and identifies outage fallbacks", async (st) => {
    let now = Date.now();
    st.mock.method(Date, "now", () => now);
    let reads = 0;
    let version = 22;
    let unavailable = false;
    axios.get = async () => {
      reads++;
      if (unavailable) throw new Error("WordPress unavailable");
      return { data: { version, banners: [{
        id: "hero", desktop_media_id: 17, desktop_image: "/wp-content/uploads/hero.jpg?rev=1&v=stale",
      }] } };
    };
    await getBanners(true);
    const request = async (query = {}) => {
      const result = {};
      await getPublicBanners({ query, protocol: "https", get: () => "localhost" }, {
        setHeader(_name, value) { result.cacheControl = value; },
        json(body) { result.body = body; },
      });
      return result;
    };

    const initial = await request();
    assert.match(initial.cacheControl, /s-maxage=60/);
    assert.equal(new URL(initial.body.banners[0].desktop_image).searchParams.get("v"), "17-22");
    version++;
    assert.match((await request({ force: "true" })).cacheControl, /no-store/);
    assert.equal(reads, 1);
    now += 6_000;
    const refreshed = await request({ force: "true" });
    assert.equal(new URL(refreshed.body.banners[0].desktop_image).searchParams.get("v"), "17-23");
    assert.equal(reads, 2);
    now += 6_000;
    unavailable = true;
    const degraded = await request({ force: "true" });
    assert.equal(degraded.body.degraded, true);
    assert.match(degraded.cacheControl, /no-store/);
    assert.equal(degraded.body.banners.length, 1);
    await request({ force: "true" });
    assert.equal(reads, 3, "a failed public read also starts the upstream cooldown");
  });
});
