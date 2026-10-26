/** Small helpers for masking personally identifying data in routine messages. */
export const maskEmail = (email) => {
  if (!email || typeof email !== "string") return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};

export const maskPhone = (phone) => {
  if (!phone || typeof phone !== "string") return null;
  const clean = phone.replace(/\D/g, "");
  if (clean.length < 4) return "****";
  return `******${clean.slice(-4)}`;
};

export const redactSensitive = (obj) => {
  if (!obj || typeof obj !== "object") return obj;

  const sensitiveKeywords = ["password", "user_pass", "token", "secret", "cookie", "authorization", "card", "cvv"];
  if (Array.isArray(obj)) return obj.map((item) => redactSensitive(item));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeywords.some((keyword) => lowerKey.includes(keyword))) {
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
