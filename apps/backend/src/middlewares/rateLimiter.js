/**
 * Lightweight, zero-dependency in-memory rate limiter
 * Protects auth routes from brute-force and spam attacks.
 */
export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 15,                  // max attempts
  message = "Too many requests. Please try again later.",
} = {}) => {
  const requests = new Map();

  // Periodic cleanup every 10 minutes to prevent memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(ip);
      }
    }
  }, 10 * 60 * 1000).unref();

  return (req, res, next) => {
    // In local development or if disabled, pass through
    if (process.env.DISABLE_RATE_LIMIT === "true") {
      return next();
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const record = requests.get(ip);

    if (!record || now - record.startTime > windowMs) {
      requests.set(ip, { count: 1, startTime: now });
      return next();
    }

    if (record.count >= max) {
      const remainingSeconds = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.set("Retry-After", String(remainingSeconds));

      return res.status(429).json({
        success: false,
        message: `${message} (${remainingSeconds}s remaining)`,
      });
    }

    record.count += 1;
    next();
  };
};

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts per 15 minutes
  message: "Too many authentication attempts. Please try again in a few minutes.",
});
