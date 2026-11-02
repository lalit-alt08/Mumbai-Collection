export const transformMediaUrl = (url, req) => {
  if (!url || typeof url !== "string") return url;

  let relativePath = null;
  const wpMarker = "/wp-content/uploads/";
  const apiMarker = "/api/media/uploads/";

  const wpIndex = url.indexOf(wpMarker);
  const apiIndex = url.indexOf(apiMarker);

  if (wpIndex !== -1) {
    relativePath = url.substring(wpIndex + wpMarker.length);
  } else if (apiIndex !== -1) {
    relativePath = url.substring(apiIndex + apiMarker.length);
  }

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
 */
export const transformSrcset = (srcset, req) => {
  if (!srcset || typeof srcset !== "string") return srcset;

  return srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
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
