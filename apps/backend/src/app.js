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

const app = express();

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = [
  process.env.CUSTOMER_ORIGIN,
  process.env.ADMIN_ORIGIN,
  process.env.EMPLOYEE_ORIGIN,
  process.env.CLIENT_ORIGIN,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) or in allowed list
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === "development") {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

app.use("/api/products", productRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/employee", employeeRoutes);

app.get("/", (req, res) => {
  res.send("Backend is running");
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