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
import { verifyCsrf } from "./middlewares/csrfMiddleware.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
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

const isDevLocalhost = (origin) => {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
};

app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) or explicitly allowed origins
      if (!origin || allowedOrigins.includes(origin) || isDevLocalhost(origin)) {
        return callback(null, true);
      }
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
    ],
    credentials: true,
  })
);

app.use(express.json());

// CSRF Protection for cookie-authenticated state-changing requests
app.use(verifyCsrf(allowedOrigins));

app.use("/api/store", storeRoutes);
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
    console.error("Unhandled API Error:", err.stack || err.message);
  }

  res.status(status).json({
    success: false,
    message: status === 500 && !isDev ? "An internal server error occurred." : err.message || "An unexpected error occurred.",
    ...(isDev && { stack: err.stack }),
  });
});

export default app;