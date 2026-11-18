import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import sharp from "sharp";
import { uploadMedia } from "../src/services/wordpressMediaService.js";

test("image upload does not fall back after an uncertain internal write", async (t) => {
  const originalPost = axios.post;
  const originalKey = process.env.MUMBAI_INTERNAL_API_KEY;
  const originalPassword = process.env.WP_APPLICATION_PASSWORD;
  process.env.MUMBAI_INTERNAL_API_KEY = "test-key";
  process.env.WP_APPLICATION_PASSWORD = "test-password";
  t.after(() => {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.MUMBAI_INTERNAL_API_KEY; else process.env.MUMBAI_INTERNAL_API_KEY = originalKey;
    if (originalPassword === undefined) delete process.env.WP_APPLICATION_PASSWORD; else process.env.WP_APPLICATION_PASSWORD = originalPassword;
  });
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  let calls = 0;
  axios.post = async () => { calls++; throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); };
  await assert.rejects(uploadMedia({ originalname: "photo.png", buffer }), /timeout/);
  assert.equal(calls, 1);

  calls = 0;
  axios.post = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("not found"), { response: { status: 404 } });
    return { data: { id: 42, source_url: "https://example.com/photo.webp" } };
  };
  const result = await uploadMedia({ originalname: "photo.png", buffer }, { trackPending: false });
  assert.equal(result.id, 42);
  assert.equal(calls, 2);
});
