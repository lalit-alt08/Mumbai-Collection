import dns from "dns";
import net from "net";
import { imageSize } from "image-size";

/**
 * Image Validation Utility
 * Enforces magic-byte verification, server-derived extension, filename sanitization,
 * and maximum dimension boundaries (pixel-flood / decompression-bomb guard).
 */

const MAX_IMAGE_WIDTH = 6000;
const MAX_IMAGE_HEIGHT = 6000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // Existing admin limit
export const EMPLOYEE_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const FORMAT_TYPES = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

/**
 * Identify real image format by inspecting magic bytes
 */
export const detectImageFormat = (buffer) => {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: "jpeg", ext: "jpg", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: "png", ext: "png", mime: "image/png" };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { format: "gif", ext: "gif", mime: "image/gif" };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { format: "webp", ext: "webp", mime: "image/webp" };
  }

  return null;
};

const hasJpegEndMarker = (buffer) =>
  buffer.length >= 4 && buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 2;

const hasPngStructure = (buffer) => {
  if (buffer.length < 33) return false;

  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > buffer.length) return false;
    if (chunkType === "IHDR") {
      if (sawHeader || length !== 13) return false;
      sawHeader = true;
    }
    if (chunkType === "IEND") {
      if (length !== 0) return false;
      sawEnd = true;
      break;
    }

    offset = chunkEnd;
  }

  return sawHeader && sawEnd;
};

const hasGifStructure = (buffer) =>
  buffer.length >= 14 && buffer.lastIndexOf(0x3b) >= 13;

const hasWebpStructure = (buffer) => {
  if (buffer.length < 20) return false;
  const declaredRiffSize = buffer.readUInt32LE(4);
  // RIFF size excludes the first 8 bytes. Extra trailing bytes are allowed.
  return declaredRiffSize >= 12 && declaredRiffSize + 8 <= buffer.length;
};

const hasSafeStructure = (buffer, format) => {
  switch (format) {
    case "jpeg":
      return hasJpegEndMarker(buffer);
    case "png":
      return hasPngStructure(buffer);
    case "webp":
      return hasWebpStructure(buffer);
    case "gif":
      return hasGifStructure(buffer);
    default:
      return false;
  }
};

/**
 * Parse dimensions for every supported image format. image-size reads only
 * bounded headers; the structure checks above reject truncated streams before
 * any media is sent to WordPress.
 */
export const checkImageDimensions = (buffer, format) => {
  if (!buffer || !FORMAT_TYPES[format] || !hasSafeStructure(buffer, format)) {
    return { valid: false, width: null, height: null };
  }

  try {
    const dimensions = imageSize(buffer);
    const expectedType = FORMAT_TYPES[format];
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);

    if (dimensions?.type !== expectedType || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return { valid: false, width: null, height: null };
    }

    return {
      valid: width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT,
      width,
      height,
    };
  } catch {
    return { valid: false, width: null, height: null };
  }
};

/**
 * Sanitize filename to prevent directory traversal or control characters
 */
export const sanitizeFilename = (filename = "upload", safeExt = "jpg") => {
  const baseName = filename
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  const cleanBase = baseName || "image";
  return `${cleanBase}_${Date.now()}.${safeExt}`;
};

/**
 * Comprehensive Image Validation
 */
export const validateImageBuffer = (file, options = {}) => {
  if (!file || !file.buffer) {
    return { valid: false, message: "No file data received." };
  }

  const maxFileSizeBytes = Number(options.maxFileSizeBytes) || MAX_IMAGE_SIZE_BYTES;
  if (file.buffer.length > maxFileSizeBytes) {
    const maxSizeMb = Math.floor(maxFileSizeBytes / (1024 * 1024));
    return { valid: false, message: `File size exceeds the ${maxSizeMb}MB limit.` };
  }

  const detected = detectImageFormat(file.buffer);
  if (!detected) {
    return {
      valid: false,
      message: "Invalid file signature. Only authentic JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }

  const dimensions = checkImageDimensions(file.buffer, detected.format);
  if (!dimensions.valid) {
    return {
      valid: false,
      message: "Invalid or unsupported image data. The image may be malformed or exceed the 6000x6000 pixel limit.",
    };
  }

  // Mutate file metadata with server-derived safe values
  file.mimetype = detected.mime;
  file.originalname = sanitizeFilename(file.originalname, detected.ext);

  return {
    valid: true,
    format: detected.format,
    ext: detected.ext,
    width: dimensions.width,
    height: dimensions.height,
  };
};

/**
 * Checks whether an IP address (IPv4 or IPv6) is private, loopback, link-local,
 * multicast, or otherwise restricted from outbound external fetches.
 */
export const isPrivateOrRestrictedIp = (ipStr) => {
  if (!ipStr || typeof ipStr !== "string") return true;
  const ip = ipStr.trim().toLowerCase();

  // IPv4 inspection
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network RFC 1918)
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT RFC 6598)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 127.0.0.0/8 (Loopback RFC 1122)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata RFC 3927)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network RFC 1918: 172.16.0.0 – 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    // 192.168.0.0/16 (Private network RFC 1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved / Broadcast)
    if (parts[0] >= 240) return true;

    return false;
  }

  // IPv6 inspection
  if (net.isIPv6(ip)) {
    // Loopback & Unspecified
    if (
      ip === "::1" ||
      ip === "0:0:0:0:0:0:0:1" ||
      ip === "::" ||
      ip === "0:0:0:0:0:0:0:0"
    ) {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
    if (ip.startsWith("::ffff:") || ip.startsWith("0:0:0:0:0:ffff:")) {
      const rest = ip.replace(/^::ffff:|^0:0:0:0:0:ffff:/, "");
      if (net.isIPv4(rest)) {
        return isPrivateOrRestrictedIp(rest);
      }
      return true;
    }

    // Unique Local Addresses (ULA): fc00::/7 (fc00:: through fdff::)
    if (/^f[cd][0-9a-f]{2}:/i.test(ip) || ip.startsWith("fc") || ip.startsWith("fd")) {
      return true;
    }

    // Link-Local: fe80::/10 (fe80:: through febf::)
    if (
      /^fe[89ab][0-9a-f]:/i.test(ip) ||
      ip.startsWith("fe80:") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb")
    ) {
      return true;
    }

    // Deprecated Site-Local: fec0::/10
    if (/^fe[c-f][0-9a-f]:/i.test(ip)) {
      return true;
    }

    // Multicast: ff00::/8
    if (ip.startsWith("ff")) {
      return true;
    }

    // Discard prefix / Documentation: 100::/64, 2001:db8::/32
    if (ip.startsWith("100:") || ip.startsWith("2001:db8:") || ip.startsWith("2001:20:")) {
      return true;
    }

    return false;
  }

  // Neither valid IPv4 nor IPv6
  return true;
};

/**
 * Validates external image URLs against SSRF (Server-Side Request Forgery) attacks.
 * Rejects non-HTTP(S) protocols, loopback/private/link-local IP addresses (IPv4 & IPv6),
 * bracketed IPv6 literals, and hostnames resolving to internal/private IPs via DNS.
 */
export const isSafeExternalImageUrl = async (urlStr) => {
  if (!urlStr || typeof urlStr !== "string") return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // Strip bracket notation from IPv6 hostnames (e.g. "[::1]" -> "::1")
    const rawHost = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().trim();
    if (!rawHost) return false;

    // Check common loopback, local, and reserved internal hostnames
    if (
      rawHost === "localhost" ||
      rawHost.endsWith(".localhost") ||
      rawHost.endsWith(".local") ||
      rawHost.endsWith(".internal") ||
      rawHost.endsWith(".arpa") ||
      rawHost.endsWith(".test") ||
      rawHost.endsWith(".example") ||
      rawHost.endsWith(".invalid") ||
      rawHost === "0.0.0.0"
    ) {
      return false;
    }

    // If hostname is directly an IP address, evaluate immediately without DNS lookup
    if (net.isIP(rawHost)) {
      return !isPrivateOrRestrictedIp(rawHost);
    }

    // Resolve domain hostnames via DNS with a strict timeout to prevent stalls
    const addresses = await dns.promises.lookup(rawHost, {
      all: true,
      signal: AbortSignal.timeout(2500),
    });

    if (!addresses || addresses.length === 0) {
      return false;
    }

    // Ensure NONE of the resolved IP addresses point to private/restricted ranges
    for (const entry of addresses) {
      if (isPrivateOrRestrictedIp(entry.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

