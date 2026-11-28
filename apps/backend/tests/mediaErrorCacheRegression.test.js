import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import axios from "axios";
import mediaRoutes, { _setMediaStreamIdleTimeoutForTesting } from "../src/routes/mediaRoutes.js";

function response() {
  const headers = new Map();
  const res = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  res.headersSent = false;
  res.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  res.removeHeader = (name) => headers.delete(name.toLowerCase());
  res.getHeader = (name) => headers.get(name.toLowerCase());
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json");
    res.body = body;
    res.end();
    return res;
  };
  return res;
}

async function request(path, query = {}) {
  const req = { method: "GET", url: path, path, headers: {}, query };
  const res = response();
  await mediaRoutes.handle(req, res, () => {});
  await new Promise((resolve) => res.writableFinished ? resolve() : res.once("finish", resolve));
  return res;
}

test("media errors are non-cacheable and do not retain upstream media headers", async () => {
  const originalAdapter = axios.defaults.adapter;
  try {
    const validation = await request("/uploads/unsupported.php");
    assert.equal(validation.statusCode, 403);
    assert.match(validation.getHeader("Cache-Control"), /no-store/);

    axios.defaults.adapter = async () => {
      throw Object.assign(new Error("Upstream refused media request"), {
        code: "ERR_BAD_REQUEST",
        response: { status: 429, data: Readable.from(["throttled"]) },
      });
    };
    const throttled = await request("/uploads/test.png", { v: "1" });
    assert.equal(throttled.statusCode, 502);
    assert.match(throttled.getHeader("Cache-Control"), /no-store/);

    axios.defaults.adapter = async () => ({
      status: 200,
      headers: {
        "content-type": "image/png", "content-length": "2000",
        "content-range": "bytes 0-1999/2000", "accept-ranges": "bytes",
        etag: '"upstream-etag"', "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
      },
      data: new Readable({ read() { this.destroy(new Error("upstream stream failed")); } }),
    });
    const failed = await request("/uploads/test.png", { v: "1" });
    assert.equal(failed.statusCode, 502);
    assert.match(failed.getHeader("Cache-Control"), /no-store/);
    assert.equal(failed.getHeader("Content-Type"), "application/json");
    for (const header of ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      assert.equal(failed.getHeader(header), undefined);
    }
    assert.equal(failed.body.success, false);

    axios.defaults.adapter = async () => ({
      status: 200, headers: { "content-type": "image/png" }, data: Readable.from(["image"]),
    });
    const image = await request("/uploads/test.png", { v: "1" });
    assert.equal(image.statusCode, 200);
    assert.match(image.getHeader("Cache-Control"), /max-age=2592000/);
    assert.equal(image.getHeader("Pragma"), undefined);
    assert.equal(image.getHeader("Expires"), undefined);
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
});

test("media proxy destroys rejected error streams and aborts stalled upstream streams", async () => {
  const originalAdapter = axios.defaults.adapter;
  try {
    const destroyed = [];
    let attempts = 0;
    axios.defaults.adapter = async (config) => {
      attempts += 1;
      const errStream = new Readable({ read() {} });
      const origDestroy = errStream.destroy.bind(errStream);
      errStream.destroy = (...args) => {
        destroyed.push(config.url);
        return origDestroy(...args);
      };
      const upstreamErr = new Error("Request failed with status code 404");
      upstreamErr.response = { status: 404, headers: { "content-type": "text/html" }, data: errStream };
      throw upstreamErr;
    };

    const notFound = await request("/uploads/item.SY522.jpg");
    assert.equal(attempts, 2, "must try primary and _SY522_ fallback URL once each");
    assert.equal(notFound.statusCode, 404);
    assert.match(notFound.getHeader("Cache-Control"), /no-store/);
    assert.equal(destroyed.length, 2, "both primary 404 and fallback 404 streams must be destroyed");

    _setMediaStreamIdleTimeoutForTesting(40);
    const stalledStream = new Readable({ read() {} });
    axios.defaults.adapter = async () => ({
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": "50000" },
      data: stalledStream,
    });
    const stalled = await request("/uploads/welcome.mp4");
    assert.equal(stalled.statusCode, 502);
    assert.match(stalled.getHeader("Cache-Control"), /no-store/);
    assert.equal(stalled.getHeader("Content-Length"), undefined);
    assert.equal(stalledStream.destroyed, true);
  } finally {
    _setMediaStreamIdleTimeoutForTesting(null);
    axios.defaults.adapter = originalAdapter;
  }
});
