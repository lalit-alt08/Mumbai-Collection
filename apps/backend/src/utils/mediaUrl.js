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
