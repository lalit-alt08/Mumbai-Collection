/**
 * Lightweight, zero-dependency in-memory rate limiter
 * Protects auth and upload routes from brute-force and spam attacks.
 */
export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 15,                  // max attempts
  message = "Too many requests. Please try again later.",
  keyGenerator,
} = {}) => {
  const requests = new Map();

  // Periodic cleanup every 10 minutes to prevent memory growth
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(key);
      }
    }
  }, 10 * 60 * 1000);

  if (cleanupTimer && typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  const limiter = (req, res, next) => {
    // In local development or if disabled, pass through
    if (process.env.DISABLE_RATE_LIMIT === "true") {
      return next();
    }

    let key;
    if (typeof keyGenerator === "function") {
      key = keyGenerator(req);
    }
    if (!key) {
      key = req.ip || req.socket?.remoteAddress || "unknown";
    }

    const now = Date.now();
    const record = requests.get(key);

    if (!record || now - record.startTime > windowMs) {
      requests.set(key, { count: 1, startTime: now });
      return next();
    }

    if (record.count >= max) {
      const remainingSeconds = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.set("Retry-After", String(remainingSeconds));

      return res.status(429).json({
        success: false,
        message: `${message} (${remainingSeconds}s remaining)`,
        retryAfter: remainingSeconds,
      });
    }

    record.count += 1;
    next();
  };

  limiter.reset = () => {
    requests.clear();
  };

  limiter.keyGenerator = keyGenerator;

  return limiter;
};

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 minutes
  message: "Too many authentication attempts. Please try again in a few minutes.",
});

export const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // 30 uploads per 10 minutes per authenticated user (or per IP if unauthenticated)
  message: "Upload rate limit reached. Please wait a few minutes before uploading again.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `user:${userId}`;
    }
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    return `ip:${ip}`;
  },
});

export const storeLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests per minute per IP
  message: "Too many store requests. Please slow down.",
});

export const checkoutLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,                  // 5 checkout attempts per 5 minutes per IP/user
  message: "Too many checkout attempts. Please try again in a few minutes.",
  keyGenerator: (req) => {
    const userId = req.user?.id || req.wpUserId;
    if (userId) {
      return `checkout:user:${userId}`;
    }
    const customerAuth =
      req.cookies?.mumbai_customer_auth ||
      req.cookies?.mumbai_wp_auth;
    if (customerAuth) {
      return `checkout:cookie:${customerAuth.slice(-32)}`;
    }
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    return `checkout:ip:${clientIp}`;
  },
});
