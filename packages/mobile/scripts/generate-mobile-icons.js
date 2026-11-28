const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const assetsDir = path.resolve(__dirname, "..", "assets");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function blendPixel(buf, width, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  if (idx + 3 >= buf.length) return;
  const alpha = Math.max(0, Math.min(1, a));
  const inv = 1 - alpha;
  buf[idx] = Math.round(r * alpha + buf[idx] * inv);
  buf[idx + 1] = Math.round(g * alpha + buf[idx + 1] * inv);
  buf[idx + 2] = Math.round(b * alpha + buf[idx + 2] * inv);
  buf[idx + 3] = Math.round(Math.min(255, buf[idx + 3] + 255 * alpha * (1 - buf[idx + 3] / 255)));
}

/**
 * 绘制 Ink & Mist 青瓷图标：圆润对话框气泡 + 四芒星脉冲徽章。
 */
function renderIcon({ size, transparentBg, bgRgb, fgRgb, accentRgb, paddingRatio }) {
  const buf = Buffer.alloc(size * size * 4);
  if (!transparentBg) {
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = bgRgb[0];
      buf[i * 4 + 1] = bgRgb[1];
      buf[i * 4 + 2] = bgRgb[2];
      buf[i * 4 + 3] = 255;
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * (0.5 - paddingRatio);
  const bubbleRx = radius * 0.86;
  const bubbleRy = radius * 0.72;
  const corner = radius * 0.34;

  // Rounded chat bubble + tail at bottom-left
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx) - (bubbleRx - corner);
      const dy = Math.abs(y - (cy - radius * 0.06)) - (bubbleRy - corner);
      const distRect = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - corner;

      // Tail triangle near bottom-left of bubble
      const tx = x - (cx - bubbleRx * 0.42);
      const ty = y - (cy + bubbleRy * 0.65);
      const inTail =
        ty >= 0 &&
        ty <= radius * 0.32 &&
        tx >= -ty * 0.65 &&
        tx <= radius * 0.36 - ty * 0.9;

      let alpha = 0;
      if (distRect <= 1) {
        alpha = Math.max(0, Math.min(1, 0.5 - distRect));
      }
      if (inTail) {
        alpha = Math.max(alpha, 1);
      }
      if (alpha > 0) {
        blendPixel(buf, size, x, y, fgRgb[0], fgRgb[1], fgRgb[2], alpha);
      }

      // Inner 4-point star sparkle cutout / accent
      const sx = (x - cx) / (radius * 0.44);
      const sy = (y - (cy - radius * 0.06)) / (radius * 0.44);
      const starDist = Math.pow(Math.abs(sx), 0.62) + Math.pow(Math.abs(sy), 0.62);
      if (starDist <= 1.04) {
        const sa = Math.max(0, Math.min(1, (1.04 - starDist) * 14));
        blendPixel(buf, size, x, y, accentRgb[0], accentRgb[1], accentRgb[2], sa);
      }
    }
  }

  return encodePng(size, size, buf);
}

fs.mkdirSync(assetsDir, { recursive: true });

// 1. iOS & universal app icon (1024x1024, celadon #0F766E background, mist #F6F6F2 mark)
fs.writeFileSync(
  path.join(assetsDir, "icon.png"),
  renderIcon({
    size: 1024,
    transparentBg: false,
    bgRgb: [15, 118, 110],
    fgRgb: [246, 246, 242],
    accentRgb: [15, 118, 110],
    paddingRatio: 0.16,
  }),
);

// 2. Android adaptive foreground icon (1024x1024, transparent background, safe zone padded)
fs.writeFileSync(
  path.join(assetsDir, "adaptive-icon.png"),
  renderIcon({
    size: 1024,
    transparentBg: true,
    bgRgb: [15, 118, 110],
    fgRgb: [255, 255, 255],
    accentRgb: [15, 118, 110],
    paddingRatio: 0.24,
  }),
);

// 3. Splash icon (512x512, transparent background, celadon #0F766E mark on #F6F6F2 splash)
fs.writeFileSync(
  path.join(assetsDir, "splash-icon.png"),
  renderIcon({
    size: 512,
    transparentBg: true,
    bgRgb: [246, 246, 242],
    fgRgb: [15, 118, 110],
    accentRgb: [246, 246, 242],
    paddingRatio: 0.16,
  }),
);

console.log("Generated Ink & Mist mobile icons in", assetsDir);
