const { deflateSync, crc32 } = require('zlib');
const fs = require('fs');
const path = require('path');

const BLUE = [0x5b, 0x8c, 0xff];
const BLUE_DEEP = [0x3b, 0x5b, 0xdb];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function cover(dist) {
  return Math.min(1, Math.max(0, 0.65 - dist));
}

function roundRect(px, py, size, radius) {
  const cx = size / 2;
  const cy = size / 2;
  const hw = size / 2;
  const hh = size / 2;
  const qx = Math.abs(px - cx) - hw + radius;
  const qy = Math.abs(py - cy) - hh + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function bell(px, py, size) {
  const cx = size * 0.5;
  const knob = Math.hypot(px - cx, py - size * 0.292) - size * 0.032;
  const domeCy = size * 0.45;
  const domeR = size * 0.15;
  const inDome = py <= domeCy + size * 0.01;
  const dome = inDome ? Math.hypot(px - cx, py - domeCy) - domeR : Infinity;
  const top = domeCy - size * 0.01;
  const bot = size * 0.655;
  let flare = Infinity;
  if (py >= top && py <= bot) {
    const t = (py - top) / (bot - top);
    const half = domeR * 0.78 + t * size * 0.125;
    flare = Math.abs(px - cx) - half;
  }
  const lip = Math.hypot((px - cx) / (size * 0.3), (py - size * 0.675) / (size * 0.048)) - 1;
  const clapper = Math.hypot(px - cx, py - size * 0.765) - size * 0.042;
  return Math.min(knob, dome, flare, lip * size * 0.048, clapper);
}

function draw(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.26;
  const ux = Math.sin((145 * Math.PI) / 180);
  const uy = -Math.cos((145 * Math.PI) / 180);
  let min = Infinity;
  let max = -Infinity;
  const samples = [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ];
  for (const [x, y] of samples) {
    const p = x * ux + y * uy;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  const span = max - min || 1;

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const tile = cover(roundRect(px, py, size, radius));
      const t = (px * ux + py * uy - min) / span;
      let r = mix(BLUE[0], BLUE_DEEP[0], t);
      let g = mix(BLUE[1], BLUE_DEEP[1], t);
      let b = mix(BLUE[2], BLUE_DEEP[2], t);
      const highlight = cover(roundRect(px, py - size * 0.015, size, radius)) * (1 - py / size) * 0.22;
      r = Math.min(255, r + highlight * 255);
      g = Math.min(255, g + highlight * 255);
      b = Math.min(255, b + highlight * 255);
      const mark = cover(bell(px, py, size));
      r = mix(r, 255, mark);
      g = mix(g, 255, mark);
      b = mix(b, 255, mark);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = Math.round(tile * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return {
    raw,
    png: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  };
}

function toDib(size, raw) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const s = srcRow + 1 + x * 4;
      const d = (y * size + x) * 4;
      const alpha = raw[s + 3] / 255;
      xor[d] = Math.round(raw[s + 2] * alpha);
      xor[d + 1] = Math.round(raw[s + 1] * alpha);
      xor[d + 2] = Math.round(raw[s] * alpha);
      xor[d + 3] = raw[s + 3];
    }
  }
  header.writeUInt32LE(xor.length + mask.length, 20);
  return Buffer.concat([header, xor, mask]);
}

function writeIco(file, images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + dir.length;
  const blobs = [header, dir];
  for (let i = 0; i < count; i++) {
    const { size, dib } = images[i];
    const at = i * 16;
    dir[at] = size >= 256 ? 0 : size;
    dir[at + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(dib.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += dib.length;
    blobs.push(dib);
  }
  fs.writeFileSync(file, Buffer.concat(blobs));
}

const dir = __dirname;
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => {
  const drawn = draw(size);
  return { size, png: drawn.png, dib: toDib(size, drawn.raw) };
});
fs.writeFileSync(path.join(dir, 'icon.png'), images.at(-1).png);
writeIco(path.join(dir, 'icon.ico'), images);
