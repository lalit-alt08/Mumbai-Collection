export const transformMediaUrl = (url, req) => {
  if (!url || typeof url !== "string") return url;

  const uploadMarker = "/wp-content/uploads/";
  const uploadIndex = url.indexOf(uploadMarker);
  if (uploadIndex === -1) {
    return url;
  }

  const relativePath = url.substring(uploadIndex + uploadMarker.length);

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

export const transformMediaUrls = (data, req) => {
  if (!data) return data;

  if (typeof data === "string") {
    return transformMediaUrl(data, req);
  }

  if (Array.isArray(data)) {
    return data.map((item) => transformMediaUrls(item, req));
  }

  if (typeof data === "object") {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = transformMediaUrls(value, req);
    }
    return result;
  }

  return data;
};
