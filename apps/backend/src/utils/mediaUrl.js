const WP_BASE_URL = process.env.WORDPRESS_URL || "https://mumbai-collection.local";
let configuredWpHost = "";
try {
  configuredWpHost = new URL(WP_BASE_URL).hostname.toLowerCase();
} catch (_) {}

const APPROVED_WP_HOSTS = new Set([
  "mumbai-collection.local",
  "mumbaicollection.local",
  "localhost",
  "127.0.0.1",
  ...(configuredWpHost ? [configuredWpHost] : []),
]);

const isWordPressTarget = (trimmed) => {
  // If it's a relative path starting with /wp-content/uploads/ or /api/media/uploads/
  if (
    trimmed.startsWith("/wp-content/uploads/") ||
    trimmed.startsWith("wp-content/uploads/") ||
    trimmed.startsWith("/api/media/uploads/") ||
    trimmed.startsWith("api/media/uploads/")
  ) {
    return true;
  }

  // If it's an absolute URL, parse it and check if hostname is in APPROVED_WP_HOSTS
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const wpBase = process.env.WORDPRESS_URL;
    let runtimeHost = "";
    if (wpBase) {
      try {
        runtimeHost = new URL(wpBase).hostname.toLowerCase();
      } catch (_) {}
    }
    return (
      APPROVED_WP_HOSTS.has(hostname) ||
      Boolean(runtimeHost && hostname === runtimeHost)
    );
  } catch (_) {
    return false;
  }
};

export const transformMediaUrl = (url, req) => {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed) return url;

  // Never rewrite data URIs, blob URLs, or local placeholders
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/product-placeholder.svg")
  ) {
    return url;
  }

  // Only rewrite if it's confirmed to be a WordPress target (relative or matching WordPress host)
  if (!isWordPressTarget(trimmed)) {
    return url;
  }

  let relativePath = null;
  const wpMarker = "/wp-content/uploads/";
  const apiMarker = "/api/media/uploads/";

  const wpIndex = trimmed.indexOf(wpMarker);
  const apiIndex = trimmed.indexOf(apiMarker);

  if (wpIndex !== -1) {
    relativePath = trimmed.substring(wpIndex + wpMarker.length);
  } else if (apiIndex !== -1) {
    relativePath = trimmed.substring(apiIndex + apiMarker.length);
  }

  // Preserve non-WordPress CDN/external image URLs unchanged
  if (!relativePath) {
    return url;
  }

  let baseUrl = "";
  if (req) {
    const proto =
      req.headers?.["x-forwarded-proto"] ||
      (typeof req.protocol === "string" ? req.protocol : "") ||
      "http";
    const host =
      req.headers?.["x-forwarded-host"] ||
      (typeof req.get === "function" ? req.get("host") : "") ||
      "localhost:5000";
    baseUrl = `${proto}://${host}`;
  }

  return `${baseUrl}/api/media/uploads/${relativePath}`;
};

/**
 * Transforms responsive image srcset strings containing comma-separated candidate URLs:
 * "http://host/img-679.jpg 679w, http://host/img-300.jpg 300w"
 * Preserves width/density descriptors (e.g. 679w, 2x) and query strings.
 * Safely handles data-URIs containing commas without corrupting candidate boundaries.
 */
export const transformSrcset = (srcset, req) => {
  if (!srcset || typeof srcset !== "string") return srcset;

  // Split candidates on commas followed by whitespace and candidate start,
  // preventing data-URIs with internal commas (e.g. data:image/png;base64,...) from being corrupted.
  const candidates = srcset.split(/,\s+(?=(?:https?:\/\/|\/|data:|[a-zA-Z0-9_\-\.]+\/))/i);

  return candidates
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      if (trimmed.startsWith("data:")) {
        const match = trimmed.match(/^(data:[^\s]+)(?:\s+(.+))?$/);
        if (match) {
          const url = match[1];
          const descriptor = match[2];
          return descriptor ? `${url} ${descriptor}` : url;
        }
        return trimmed;
      }
      const parts = trimmed.split(/\s+/);
      const url = parts[0];
      const descriptor = parts.slice(1).join(" ");
      const transformedUrl = transformMediaUrl(url, req);
      return descriptor ? `${transformedUrl} ${descriptor}` : transformedUrl;
    })
    .join(", ");
};

export const transformMediaUrls = (data, req) => {
  if (!data) return data;

  if (typeof data === "string") {
    if (data.includes(",") && /\s+\d+[wx]/i.test(data)) {
      return transformSrcset(data, req);
    }
    return transformMediaUrl(data, req);
  }

  if (Array.isArray(data)) {
    return data.map((item) => transformMediaUrls(item, req));
  }

  if (typeof data === "object") {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if ((key === "srcset" || key.endsWith("_srcset")) && typeof value === "string") {
        result[key] = transformSrcset(value, req);
      } else {
        result[key] = transformMediaUrls(value, req);
      }
    }
    return result;
  }

  return data;
};
