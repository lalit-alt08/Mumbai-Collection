import API_BASE from "../config/api.js";

const configuredApi = API_BASE;

const mediaOrigin = () => {
  if (typeof window === "undefined" || !window.location) return "";
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!configuredApi) return local ? "http://localhost:5000" : "";
  try {
    const origin = new URL(configuredApi, window.location.href);
    if (!local && ["localhost", "127.0.0.1"].includes(origin.hostname)) return "";
    return origin.origin === window.location.origin ? "" : origin.origin;
  } catch {
    return "";
  }
};

export const resolveMediaUrl = (url) => {
  if (typeof url !== "string" || !url.trim()) return "";
  const value = url.trim();
  if (/^(data:|blob:)/i.test(value)) return value;

  if (value.startsWith("/api/media/uploads/")) return `${mediaOrigin()}${value}`;
  if (value.startsWith("/wp-content/uploads/")) {
    return `${mediaOrigin()}/api/media/uploads/${value.slice("/wp-content/uploads/".length)}`;
  }

  try {
    const parsed = new URL(value);
    const internal = ["localhost", "127.0.0.1", "mumbai-collection.local", "mumbaicollection.local"].includes(parsed.hostname.toLowerCase());
    if (internal && parsed.pathname.startsWith("/wp-content/uploads/")) {
      return `${mediaOrigin()}/api/media/uploads/${parsed.pathname.slice("/wp-content/uploads/".length)}${parsed.search}`;
    }
    if (internal && parsed.port === "5000" && parsed.pathname.startsWith("/api/media/uploads/")) {
      return `${mediaOrigin()}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Keep relative and unrecognized URLs unchanged.
  }
  return value;
};

export default { resolveMediaUrl };
