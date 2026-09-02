/**
 * In-Memory Idempotency Middleware for Mutation Endpoints (e.g. POST /products)
 *
 * Prevents accidental duplicate creations caused by network retries, connection resets,
 * or concurrent client requests by tracking a unique X-Idempotency-Key.
 */

const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
const MAX_IDEMPOTENCY_STORE_SIZE = 2000;
const MAX_KEY_LENGTH = 128;
const MAX_PROCESSING_TIMEOUT_MS = 30 * 1000; // 30s max processing wait

// Periodic cleanup of expired and abandoned keys
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    const isExpired = now - entry.timestamp > IDEMPOTENCY_TTL_MS;
    const isAbandonedProcessing = entry.status === "processing" && (now - entry.timestamp > MAX_PROCESSING_TIMEOUT_MS);
    if (isExpired || isAbandonedProcessing) {
      idempotencyStore.delete(key);
    }
  }
}, 30 * 1000).unref();

export const requireIdempotency = (req, res, next) => {
  const idempotencyKey =
    req.headers["x-idempotency-key"] ||
    req.headers["idempotency-key"] ||
    req.body?.idempotency_key;

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.trim() ||
    idempotencyKey.trim().length > MAX_KEY_LENGTH
  ) {
    return next();
  }

  const rawKey = idempotencyKey.trim();
  const userId = req.wpUserId || req.ip || "anon";
  const routePath = `${req.baseUrl || ""}${req.path || ""}`;
  const key = `${userId}:${req.method}:${routePath}:${rawKey}`;

  // Enforce bounded store size before adding
  if (idempotencyStore.size >= MAX_IDEMPOTENCY_STORE_SIZE && !idempotencyStore.has(key)) {
    const oldestKey = idempotencyStore.keys().next().value;
    if (oldestKey) idempotencyStore.delete(oldestKey);
  }

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
