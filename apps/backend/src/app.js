import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import addressRoutes from "./routes/addressRoute.js";

import productRoutes from "./routes/productRoutes.js";
import authRoutes from "./routes/authRoute.js";
import profileRoutes from "./routes/profileRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import favoritesRoutes from "./routes/favoritesRoute.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import bannerRoutes from "./routes/bannerRoutes.js";
import storeRoutes from "./routes/storeRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";
import storeHoursRoutes from "./routes/storeHoursRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import { verifyCsrf, isOriginAllowed } from "./middlewares/csrfMiddleware.js";
import { storeLimiter } from "./middlewares/rateLimiter.js";
import pinoHttp from "pino-http";
import crypto from "crypto";
import { logger, sanitizeError } from "./utils/logger.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("X-Request-ID", requestId);
    return requestId;
  },
  customLogLevel: (req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "silent";
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.originalUrl || req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
    err: sanitizeError,
  },
}));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https:", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Google SSO + pre-whitelisting for future Razorpay iframe
        frameSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://api.razorpay.com",
        ],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        objectSrc: ["'none'"],
        // Google SSO + pre-whitelisting for future Razorpay script SDK
        scriptSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://checkout.razorpay.com",
        ],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        // Google APIs + pre-whitelisting for future Razorpay API/telemetry
        connectSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://api.razorpay.com",
          "https://lumberjack.razorpay.com",
        ],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const rawAllowedOrigins = [
  process.env.CUSTOMER_ORIGIN || "http://localhost:5173",
  process.env.ADMIN_ORIGIN || "http://localhost:5174",
  process.env.EMPLOYEE_ORIGIN || "http://localhost:5175",
  process.env.CLIENT_ORIGIN,
  process.env.FRONTEND_URL,
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()) : []),
].filter(Boolean);

const allowedOrigins = [...new Set(rawAllowedOrigins)];

app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server) or verified allowed origins
      if (!origin || isOriginAllowed(origin, allowedOrigins)) {
        return callback(null, true);
      }
      logger.warn({ origin }, "Blocked unauthorized CORS origin");
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Mumbai-Panel",
      "X-Idempotency-Key",
      "Idempotency-Key",
      "X-Requested-With",
      "Nonce",
      "nonce",
      "Cart-Token",
      "cart-token",
    ],
    exposedHeaders: [
      "Nonce",
      "nonce",
      "Cart-Token",
      "cart-token",
      "Retry-After",
      "retry-after",
    ],
    credentials: true,
    maxAge: 86400,
  })
);

app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl?.startsWith("/api/payments/webhook")) {
        req.rawBody = buf;
      }
    },
  })
);

// CSRF Protection for cookie-authenticated state-changing requests
app.use(verifyCsrf(allowedOrigins));

app.use("/api/store", storeLimiter, storeRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/products", productRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/store-hours", storeHoursRoutes);

app.get("/", (req, res) => {
  res.send("Backend is running");
});

// 404 Handler for undefined API routes (L13 fix)
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// Global Express Error Handling Middleware
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === "development";

  if (status >= 500) {
    logger.error({ err: sanitizeError(err), requestId: req.id }, "Unhandled API error");
  }

  res.status(status).json({
    success: false,
    message: status === 500 && !isDev ? "An internal server error occurred." : err.message || "An unexpected error occurred.",
    ...(isDev && { stack: err.stack }),
  });
});

export default app;
