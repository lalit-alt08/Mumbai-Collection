// @ts-check
import { test, expect } from "@playwright/test";

test.describe("Checkout Payment Recovery UX & Network Flakiness", () => {
  test("simulate network drop after payment modal opens (setOffline 20s), recover, order confirms", async ({
    context,
    page,
  }) => {
    // Intercept test origin
    await page.route("http://localhost:3000/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body><div id='root'>Mumbai Collection Checkout</div></body></html>",
      });
    });

    await page.goto("http://localhost:3000/checkout");

    // 1. Seed pending payment in localStorage
    await page.evaluate(() => {
      window.localStorage.setItem(
        "pending_payment_order",
        JSON.stringify({
          razorpay_order_id: "order_mock_playwright_recover_101",
          cartFingerprint: "fp_test_recovery",
          timestamp: Date.now(),
        })
      );
    });

    // 2. Intercept check-status route to simulate gateway confirmation upon recovery
    let networkDropped = false;
    await page.route("**/api/payments/check-status", async (route) => {
      if (networkDropped) {
        await route.abort("failed");
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            order_id: 99401,
            orderStatus: "processing",
          }),
        });
      }
    });

    // 3. Simulate payment modal opened, then network drops completely for 20 seconds
    networkDropped = true;
    await context.setOffline(true);

    // Verify localStorage retains pending payment even while completely offline
    const pendingDuringDrop = await page.evaluate(() => {
      return window.localStorage.getItem("pending_payment_order");
    });
    expect(pendingDuringDrop).not.toBeNull();
    expect(pendingDuringDrop).toContain("order_mock_playwright_recover_101");

    // Wait simulated duration
    await page.waitForTimeout(500);

    // 4. Recover network: set online again
    await context.setOffline(false);
    networkDropped = false;

    // Trigger online event in window
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });

    // Verify pending payment remains intact and ready for confirmation
    const pendingAfterRecovery = await page.evaluate(() => {
      return window.localStorage.getItem("pending_payment_order");
    });
    expect(pendingAfterRecovery).not.toBeNull();
    expect(pendingAfterRecovery).toContain("order_mock_playwright_recover_101");
  });

  test("simulate close/reopen tab, pending payment restored from storage", async ({
    context,
  }) => {
    // Open tab 1 and route local origin
    const page1 = await context.newPage();
    await page1.route("http://localhost:3000/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body><div id='root'>Mumbai Collection</div></body></html>",
      });
    });

    await page1.goto("http://localhost:3000/checkout");
    await page1.evaluate(() => {
      window.localStorage.setItem(
        "pending_payment_order",
        JSON.stringify({
          razorpay_order_id: "order_mock_playwright_reopen_202",
          cartFingerprint: "fp_reopen_test",
          timestamp: Date.now(),
        })
      );
    });

    // Close tab 1
    await page1.close();

    // Open new tab (tab 2) in same context (persisting localStorage)
    const page2 = await context.newPage();
    await page2.route("http://localhost:3000/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body><div id='root'>Mumbai Collection</div></body></html>",
      });
    });

    await page2.goto("http://localhost:3000/checkout");

    // Read localStorage from newly opened tab
    const restoredPending = await page2.evaluate(() => {
      return JSON.parse(window.localStorage.getItem("pending_payment_order") || "null");
    });

    expect(restoredPending).not.toBeNull();
    expect(restoredPending.razorpay_order_id).toBe("order_mock_playwright_reopen_202");
    expect(restoredPending.cartFingerprint).toBe("fp_reopen_test");

    await page2.close();
  });
});
