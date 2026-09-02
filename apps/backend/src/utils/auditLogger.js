/**
 * Structured Audit Logger with PII Redaction and Persistent File Retention
 * Records operational actions (product mutations, order transitions) for accountability.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "../../logs");
const AUDIT_LOG_PATH = path.join(LOG_DIR, "audit.log");

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (err) {
  console.warn("[AuditLogger] Could not initialize logs directory:", err.message);
}

/**
 * Mask email address for PII compliance (e.g. j***n@domain.com)
 */
export const maskEmail = (email) => {
  if (!email || typeof email !== "string") return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};

/**
 * Mask phone number for PII compliance (e.g. ******1234)
 */
export const maskPhone = (phone) => {
  if (!phone || typeof phone !== "string") return null;
  const clean = phone.replace(/\D/g, "");
  if (clean.length < 4) return "****";
  return `******${clean.slice(-4)}`;
};

/**
 * Deep redaction of sensitive objects
 */
export const redactSensitive = (obj) => {
  if (!obj || typeof obj !== "object") return obj;

  const SENSITIVE_KEYWORDS = [
    "password",
    "user_pass",
    "token",
    "secret",
    "cookie",
    "authorization",
    "card",
    "cvv",
  ];

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYWORDS.some((kw) => lowerKey.includes(kw));

    if (isSensitive) {
      result[key] = "[REDACTED]";
    } else if (lowerKey === "email") {
      result[key] = maskEmail(value);
    } else if (lowerKey === "phone") {
      result[key] = maskPhone(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Log a structured audit event
 */
export const logAuditEvent = ({
  req,
  action,
  targetType,
  targetId,
  details = {},
}) => {
  const actor = {
    id: req?.wpUserId || req?.user?.id || "unauthenticated",
    role: req?.wpUserRole || req?.user?.role || "guest",
    email: maskEmail(req?.wpUserEmail || req?.user?.email),
    ip: req?.ip || req?.socket?.remoteAddress || "unknown",
    userAgent: req?.headers?.["user-agent"] ? req.headers["user-agent"].slice(0, 100) : "unknown",
  };

  const auditEntry = {
    timestamp: new Date().toISOString(),
    action,
    target: {
      type: targetType,
      id: targetId,
    },
    actor,
    details: redactSensitive(details),
  };

  const jsonLine = JSON.stringify(auditEntry);

  // Write to console with distinct prefix
  console.log(`[AUDIT] ${jsonLine}`);

  // Persistent file append
  try {
    fs.appendFile(AUDIT_LOG_PATH, `${jsonLine}\n`, (err) => {
      if (err) {
        // Fail open: logging error must never break the user HTTP transaction
        console.warn("[AuditLogger] Failed to write audit log entry:", err.message);
      }
    });
  } catch (err) {
    console.warn("[AuditLogger] Persistent log write exception:", err.message);
  }
};
