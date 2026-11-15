import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { handleWebhook } from "../src/controllers/paymentWebhookHandler.js";
import { _setWpClientForTesting } from "../src/services/paymentIntentService.js";

test("webhook acknowledgement waits for durable storage and rejects storage failure", async (t) => {
  const oldSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = "isolated-test-secret";
  t.after(async () => {
    _setWpClientForTesting(null);
    if (oldSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = oldSecret;
    const { closeRedis } = await import("../src/config/redis.js");
    await closeRedis();
  });

  const body = { event: "payment.failed", id: "evt_durable_boundary" };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const req = { headers: { "x-razorpay-signature": signature }, body, rawBody };
  const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } });

  let releaseStore;
  const storeBarrier = new Promise((resolve) => { releaseStore = resolve; });
  _setWpClientForTesting({ post: async (path) => {
    if (path.endsWith("/webhook-event/store")) await storeBarrier;
    return { data: { success: true, updated: true } };
  } });
  const res = response();
  const handling = handleWebhook(req, res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.statusCode, 0, "must not acknowledge before durable storage completes");
  releaseStore();
  await handling;
  assert.equal(res.statusCode, 200);

  _setWpClientForTesting({ post: async () => { throw new Error("simulated unavailable database"); } });
  const failed = response();
  await handleWebhook(req, failed);
  assert.equal(failed.statusCode, 500, "storage failure must request a retry");
});
