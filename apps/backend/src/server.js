import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

// Process safety crash guards
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Align keepAliveTimeout with reverse proxies (e.g. ALB, Cloudflare, Nginx)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Graceful shutdown
const gracefulShutdown = () => {
  console.log("Received shutdown signal. Closing HTTP server...");
  server.close(() => {
    console.log("HTTP server closed. Exiting process.");
    process.exit(0);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);