import "dotenv/config";
import app from "./app.js";
import { logger, sanitizeError } from "./utils/logger.js";

const PORT = process.env.PORT || 5000;

// Startup safety check for production configuration
if (process.env.NODE_ENV === "production") {
  const wpUrl = process.env.WORDPRESS_URL || "";
  const wooUrl = process.env.WOOCOMMERCE_URL || "";

  if (wpUrl.includes(".local") || wooUrl.includes(".local")) {
    logger.error({ wordpressUrl: wpUrl, woocommerceUrl: wooUrl }, "Production environment must not use local service URLs");
  }

  if (!process.env.ADMIN_ORIGIN || !process.env.EMPLOYEE_ORIGIN) {
    logger.warn("Production configuration missing ADMIN_ORIGIN or EMPLOYEE_ORIGIN");
  }
}

// Process safety crash guards
process.on("unhandledRejection", (reason) => {
  logger.error({ err: sanitizeError(reason) }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err: sanitizeError(err) }, "Uncaught exception");
  process.exit(1);
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server is running");
});

// Align keepAliveTimeout with reverse proxies (e.g. ALB, Cloudflare, Nginx)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info("Received shutdown signal. Closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed. Exiting process");
    process.exit(0);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
