const { nativeImage } = require('electron');
const path = require('path');

const GLYPHS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
};

const baseCache = new Map();

function basePixels(size) {
  if (!baseCache.has(size)) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    const scaled = icon.resize({ width: size, height: size, quality: 'best' });
    baseCache.set(size, Buffer.from(scaled.toBitmap()));
  }
  return Buffer.from(baseCache.get(size));
}

function blend(buf, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
  const i = (y * size + x) * 4;
  if (a >= 1) {
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = 255;
    return;
  }
  const dstA = buf[i + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  buf[i + 2] = Math.round((r * a + buf[i + 2] * dstA * (1 - a)) / outA);
  buf[i + 1] = Math.round((g * a + buf[i + 1] * dstA * (1 - a)) / outA);
  buf[i] = Math.round((b * a + buf[i] * dstA * (1 - a)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

function fillRoundRect(buf, size, x, y, w, h, radius, color) {
  const [r, g, b] = color;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2;
  const hh = h / 2;
  const x0 = Math.floor(x - 1);
  const y0 = Math.floor(y - 1);
  const x1 = Math.ceil(x + w + 1);
  const y1 = Math.ceil(y + h + 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const qx = Math.abs(px + 0.5 - cx) - hw + radius;
      const qy = Math.abs(py + 0.5 - cy) - hh + radius;
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const cover = Math.min(1, Math.max(0, 0.75 - dist));
      if (cover > 0) blend(buf, size, px, py, r, g, b, cover);
    }
  }
}

function measure(text, scale) {
  const gap = scale;
  return { w: text.length * 3 * scale + (text.length - 1) * gap, h: 5 * scale };
}

function drawText(buf, size, text, x, y, scale) {
  const gap = scale;
  let cursor = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            blend(buf, size, cursor + gx * scale + sx, y + gy * scale + sy, 255, 255, 255, 1);
          }
        }
      }
    }
    cursor += 3 * scale + gap;
  }
}

function paint(size, count) {
  const buf = basePixels(size);
  if (!count) return buf;

  const scale = size >= 32 ? 2 : 1;
  const text = count > 99 ? '99+' : String(count);
  const { w, h } = measure(text, scale);
  const padX = scale;
  const padY = Math.max(1, scale - 1);
  const ring = Math.max(1, scale - 1);
  const margin = size >= 32 ? scale : 0;
  let badgeH = h + padY * 2;
  let badgeW = Math.max(badgeH, w + padX * 2);
  const maxOuter = size - margin * 2;
  if (badgeW + ring * 2 > maxOuter) badgeW = maxOuter - ring * 2;
  if (badgeH + ring * 2 > maxOuter) badgeH = maxOuter - ring * 2;
  const x = size - margin - ring - badgeW;
  const y = size - margin - ring - badgeH;
  fillRoundRect(buf, size, x - ring, y - ring, badgeW + ring * 2, badgeH + ring * 2, (badgeH + ring * 2) / 2, [255, 255, 255]);
  fillRoundRect(buf, size, x, y, badgeW, badgeH, badgeH / 2, [239, 68, 68]);
  drawText(buf, size, text, Math.round(x + (badgeW - w) / 2), Math.round(y + (badgeH - h) / 2), scale);
  return buf;
}

function imageFrom(size, count) {
  return nativeImage.createFromBitmap(paint(size, count), { width: size, height: size });
}

function trayImage(count) {
  const image = imageFrom(16, count);
  image.addRepresentation({
    scaleFactor: 2,
    width: 16,
    height: 16,
    buffer: imageFrom(32, count).toPNG(),
  });
  return image;
}

module.exports = { trayImage, imageFrom };
