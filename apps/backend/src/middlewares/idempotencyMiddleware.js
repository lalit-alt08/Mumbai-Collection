/**
 * In-Memory Idempotency Middleware for Mutation Endpoints (e.g. POST /products)
 *
 * Prevents accidental duplicate creations caused by network retries, connection resets,
 * or concurrent client requests by tracking a unique X-Idempotency-Key.
 */

const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

// Periodic cleanup of expired keys
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export const requireIdempotency = (req, res, next) => {
  const idempotencyKey =
    req.headers["x-idempotency-key"] ||
    req.headers["idempotency-key"] ||
    req.body?.idempotency_key;

  if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    return next();
  }

  const key = idempotencyKey.trim();
  const cached = idempotencyStore.get(key);

  if (cached) {
    if (cached.status === "completed") {
      console.log(`[Idempotency] Returning cached response for key: ${key}`);
      return res.status(cached.statusCode).json({
        ...cached.body,
        _idempotent: true,
      });
    }

    if (cached.status === "processing") {
      console.log(`[Idempotency] Concurrent in-flight request detected for key: ${key}`);
      // Wait for ongoing request to finish
      const checkInterval = setInterval(() => {
        const latest = idempotencyStore.get(key);
        if (!latest || latest.status !== "processing") {
          clearInterval(checkInterval);
          if (latest && latest.status === "completed") {
            return res.status(latest.statusCode).json({
              ...latest.body,
              _idempotent: true,
            });
          }
          return res.status(409).json({
            success: false,
            message: "Request is currently being processed. Please wait.",
          });
        }
      }, 200);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            message: "Request processing timed out. Please retry.",
          });
        }
      }, 15000);
      return;
    }
  }

  // Mark key as processing
  idempotencyStore.set(key, {
    status: "processing",
    timestamp: Date.now(),
  });

  const originalJson = res.json.bind(res);
  let capturedStatusCode = 200;

  const originalStatus = res.status.bind(res);
  res.status = function (code) {
    capturedStatusCode = code;
    return originalStatus(code);
  };

  res.json = function (body) {
    if (capturedStatusCode >= 200 && capturedStatusCode < 300) {
      idempotencyStore.set(key, {
        status: "completed",
        statusCode: capturedStatusCode,
        body,
        timestamp: Date.now(),
      });
    } else {
      // Upon legitimate error, release key so user can retry
      idempotencyStore.delete(key);
    }
    return originalJson(body);
  };

  next();
};

export default requireIdempotency;
