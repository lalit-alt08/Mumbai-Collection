/**
 * Video buffer validation utility for Mumbai Collection.
 * Specifically validates browser-playable H.264 MP4 files.
 */

export const MAX_VIDEO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const VALID_FTYP_BRANDS = new Set([
  "isom",
  "iso2",
  "mp41",
  "mp42",
  "avc1",
  "qt  ",
  "M4V ",
  "dash",
]);

/**
 * Validates that the provided buffer is a genuine, non-malformed H.264 MP4 video
 * within the allowed size limit.
 *
 * @param {Buffer} buf - Raw file buffer
 * @param {Object} [options]
 * @param {number} [options.maxSizeBytes] - Max allowed file size in bytes
 * @returns {{ valid: boolean, message?: string, width?: number, height?: number, mime?: string }}
 */
export const validateMp4Buffer = (buf, options = {}) => {
  const maxSizeBytes = options.maxSizeBytes || MAX_VIDEO_SIZE_BYTES;

  if (!buf || !Buffer.isBuffer(buf)) {
    return { valid: false, message: "No video file content provided." };
  }

  if (buf.length > maxSizeBytes) {
    return {
      valid: false,
      message: `Video size exceeds the ${Math.round(maxSizeBytes / (1024 * 1024))}MB limit.`,
    };
  }

  if (buf.length < 32) {
    return { valid: false, message: "File is too small to be a valid MP4 video." };
  }

  // 1. Verify first box is ftyp
  const firstBoxType = buf.toString("latin1", 4, 8);
  if (firstBoxType !== "ftyp") {
    return { valid: false, message: "Invalid file format: missing MP4 ftyp container header." };
  }

  const firstBoxSize = buf.readUInt32BE(0);
  if (firstBoxSize < 16 || firstBoxSize > buf.length) {
    return { valid: false, message: "Malformed MP4 ftyp header." };
  }

  // Check major brand or compatible brands
  const majorBrand = buf.toString("latin1", 8, 12);
  let hasValidBrand = VALID_FTYP_BRANDS.has(majorBrand);
  if (!hasValidBrand) {
    for (let b = 16; b + 4 <= firstBoxSize && b + 4 <= buf.length; b += 4) {
      const compBrand = buf.toString("latin1", b, b + 4);
      if (VALID_FTYP_BRANDS.has(compBrand)) {
        hasValidBrand = true;
        break;
      }
    }
  }

  if (!hasValidBrand) {
    return { valid: false, message: "Unsupported MP4 brand. Must be standard ISO/H.264 MP4." };
  }

  // 2. Parse box hierarchy to find moov and verify H.264 (avc1/avc3) video codec
  let hasMoov = false;
  let hasH264 = false;
  let hasMdat = false;
  let width = 0;
  let height = 0;
  let malformedBox = false;
  const mediaRanges = [];
  const sampleSizes = [];
  const chunkOffsets = [];

  const scanBoxes = (start, end) => {
    let pos = start;
    while (pos + 8 <= end) {
      let size = buf.readUInt32BE(pos);
      const type = buf.toString("latin1", pos + 4, pos + 8);
      let headerSize = 8;

      if (size === 1) {
        if (pos + 16 > end) {
          malformedBox = true;
          break;
        }
        size = Number(buf.readBigUInt64BE(pos + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < headerSize || pos + size > end) {
        malformedBox = true;
        break;
      }

      if (type === "mdat") {
        hasMdat = true;
        mediaRanges.push([pos + headerSize, pos + size]);
      } else if (type === "moov") {
        hasMoov = true;
        scanBoxes(pos + headerSize, pos + size);
      } else if (["trak", "mdia", "minf", "stbl"].includes(type)) {
        scanBoxes(pos + headerSize, pos + size);
      } else if (type === "stsd") {
        if (pos + headerSize + 8 <= pos + size) {
          const entryCount = buf.readUInt32BE(pos + headerSize + 4);
          let spos = pos + headerSize + 8;
          for (let i = 0; i < entryCount && spos + 8 <= pos + size; i++) {
            const entrySize = buf.readUInt32BE(spos);
            const entryType = buf.toString("latin1", spos + 4, spos + 8);
            if (entryType === "avc1" || entryType === "avc3") {
              hasH264 = true;
              if (spos + 36 <= spos + entrySize && spos + entrySize <= pos + size) {
                width = buf.readUInt16BE(spos + 32);
                height = buf.readUInt16BE(spos + 34);
              }
            }
            if (entrySize < 8) break;
            spos += entrySize;
          }
        }
      } else if (type === "stsz") {
        // FullBox(4), sample_size(4), sample_count(4), then optional per-sample sizes.
        const payload = pos + headerSize;
        if (payload + 12 > pos + size) {
          malformedBox = true;
        } else {
          const defaultSize = buf.readUInt32BE(payload + 4);
          const count = buf.readUInt32BE(payload + 8);
          if (count > 0 && defaultSize > 0) {
            sampleSizes.push(defaultSize);
          } else if (count > 0 && payload + 12 + count * 4 <= pos + size) {
            let foundEmptySample = false;
            for (let i = 0; i < count; i++) {
              const sampleSize = buf.readUInt32BE(payload + 12 + i * 4);
              if (sampleSize > 0) sampleSizes.push(sampleSize);
              else foundEmptySample = true;
            }
            if (sampleSizes.length === 0 || foundEmptySample) malformedBox = true;
          } else {
            malformedBox = true;
          }
        }
      } else if (type === "stco" || type === "co64") {
        const payload = pos + headerSize;
        if (payload + 8 > pos + size) {
          malformedBox = true;
        } else {
          const count = buf.readUInt32BE(payload + 4);
          const widthBytes = type === "co64" ? 8 : 4;
          if (count === 0 || payload + 8 + count * widthBytes > pos + size) {
            malformedBox = true;
          } else {
            for (let i = 0; i < count; i++) {
              const at = payload + 8 + i * widthBytes;
              chunkOffsets.push(type === "co64" ? Number(buf.readBigUInt64BE(at)) : buf.readUInt32BE(at));
            }
          }
        }
      }

      pos += size;
    }
  };

  scanBoxes(0, buf.length);

  if (!hasMoov) {
    return {
      valid: false,
      message: "Invalid or incomplete MP4 video: missing movie (moov) atom.",
    };
  }

  if (!hasH264) {
    return {
      valid: false,
      message: "Unsupported video codec. Video must be encoded in H.264 (avc1) for browser compatibility.",
    };
  }

  if (malformedBox) {
    return { valid: false, message: "Invalid or incomplete MP4: malformed sample or box data." };
  }

  if (!hasMdat || mediaRanges.length === 0 || sampleSizes.length === 0 || chunkOffsets.length === 0) {
    return {
      valid: false,
      message: "Invalid or incomplete MP4: video media samples are missing.",
    };
  }

  // At least one indexed video chunk must point inside actual media payload bytes.
  const allChunksReferenceMedia = chunkOffsets.every((offset) =>
    mediaRanges.some(([start, end]) => Number.isSafeInteger(offset) && offset >= start && offset < end)
  );
  if (!allChunksReferenceMedia) {
    return {
      valid: false,
      message: "Invalid or incomplete MP4: sample index does not point to video data.",
    };
  }

  return {
    valid: true,
    width,
    height,
    mime: "video/mp4",
  };
};

export default {
  MAX_VIDEO_SIZE_BYTES,
  validateMp4Buffer,
};
