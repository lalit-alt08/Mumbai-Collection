import test from "node:test";
import assert from "node:assert/strict";
import { safeStorage, safeSessionStorage } from "../src/utils/safeStorage.js";
import {
  PENDING_PAYMENT_STORAGE_KEY,
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  computeCartFingerprint,
} from "../src/utils/checkoutIdempotency.js";

test("Stage 1 — Critical Browser Reliability Suite", async (t) => {
  await t.test("1. safeStorage: stores, retrieves, and removes keys normally", () => {
    safeStorage.setItem("test_key", "test_val");
    assert.equal(safeStorage.getItem("test_key"), "test_val");

    safeStorage.removeItem("test_key");
    assert.equal(safeStorage.getItem("test_key"), null);
  });

  await t.test("2. safeStorage: getJSON and setJSON handle valid and invalid JSON safely", () => {
    const data = { id: 123, name: "Mumbai User" };
    safeStorage.setJSON("test_json", data);
    assert.deepEqual(safeStorage.getJSON("test_json"), data);

    // Invalid JSON returns default value
    safeStorage.setItem("bad_json", "{not_valid_json}");
    assert.equal(safeStorage.getJSON("bad_json", null), null);
    assert.deepEqual(safeStorage.getJSON("bad_json", {}), {});

    // Missing key returns default value
    assert.equal(safeStorage.getJSON("nonexistent_key", "fallback"), "fallback");

    safeStorage.removeItem("test_json");
    safeStorage.removeItem("bad_json");
  });

  await t.test("3. safeStorage: works in memory fallback when storage throws", () => {
    // Force in-memory fallback by simulating unavailable storage
    const originalWindow = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError: Access is denied");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError: Access is denied");
        },
      },
    };

    assert.doesNotThrow(() => {
      safeStorage.setItem("fallback_key", "fallback_value");
      const val = safeStorage.getItem("fallback_key");
      assert.equal(val, "fallback_value");
      safeStorage.removeItem("fallback_key");
      assert.equal(safeStorage.getItem("fallback_key"), null);
    });

    globalThis.window = originalWindow;
  });

  await t.test("4. safeSessionStorage: operations and fallbacks operate independently", () => {
    safeSessionStorage.setJSON("session_test", { session: true });
    assert.deepEqual(safeSessionStorage.getJSON("session_test"), { session: true });
    safeSessionStorage.removeItem("session_test");
    assert.equal(safeSessionStorage.getItem("session_test"), null);
  });

  await t.test("5. Razorpay Pending Payment Persistence: sets, gets, and clears state", () => {
    const mockCart = {
      items: [{ id: 10, quantity: 1 }],
      totals: { total_price: "99900" },
    };
    const fingerprint = computeCartFingerprint(mockCart);
    const pendingData = {
      order_id: 1234,
      razorpay_order_id: "order_rzp_5678",
      cartFingerprint: fingerprint,
      timestamp: Date.now(),
    };

    setPendingPayment(pendingData);
    const retrieved = getPendingPayment();
    assert.deepEqual(retrieved, pendingData);

    clearPendingPayment();
    assert.equal(getPendingPayment(), null);
  });

  await t.test("6. In-App WebView Detection: identifies common in-app user agents and allows standard browsers", () => {
    const isEmbeddedWebView = (ua) => {
      const isSpecificInApp =
        /Instagram|FBAN|FBAV|FB_IAB|Messenger|WhatsApp|TikTok|musical_ly|Snapchat|Line\/|Twitter|MicroMessenger|Pinterest/i.test(
          ua
        );
      const isAndroidWebView =
        /Android/i.test(ua) && (/\bwv\b/i.test(ua) || /Version\/[0-9.]+/i.test(ua));
      return Boolean(isSpecificInApp || isAndroidWebView);
    };

    // In-app user-agents
    const instagramUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0";
    const facebookUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G75 [FBAN/FBIOS;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]";
    const whatsappUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/23.1.75.1";
    const tiktokUA =
      "Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36 musical_ly_202201";
    const androidWV =
      "Mozilla/5.0 (Linux; U; Android 11; en-us; Pixel 5 Build/RQ3A.210905.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/92.0.4515.159 Mobile Safari/537.36; wv";

    assert.equal(isEmbeddedWebView(instagramUA), true, "Instagram must be detected as in-app browser");
    assert.equal(isEmbeddedWebView(facebookUA), true, "Facebook must be detected as in-app browser");
    assert.equal(isEmbeddedWebView(whatsappUA), true, "WhatsApp must be detected as in-app browser");
    assert.equal(isEmbeddedWebView(tiktokUA), true, "TikTok must be detected as in-app browser");
    assert.equal(isEmbeddedWebView(androidWV), true, "Android WebView must be detected as in-app browser");

    // Standard browsers
    const safariDesktop =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const safariMobile =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    const chromeDesktop =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const chromeMobile =
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";
    const firefoxDesktop =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0";

    assert.equal(isEmbeddedWebView(safariDesktop), false, "Safari macOS must be allowed");
    assert.equal(isEmbeddedWebView(safariMobile), false, "Mobile Safari must be allowed");
    assert.equal(isEmbeddedWebView(chromeDesktop), false, "Chrome desktop must be allowed");
    assert.equal(isEmbeddedWebView(chromeMobile), false, "Chrome mobile must be allowed");
    assert.equal(isEmbeddedWebView(firefoxDesktop), false, "Firefox desktop must be allowed");
  });
});
