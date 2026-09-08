// 生成 build/icon.png（512x512）— 纯 Node PNG 编码，无需图像库
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const W = 512, H = 512;

// CRC32
const table = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 像素：深色底渐变 + 蓝色圆环 + 中心竖条（抽象 "W" 感）
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 4);
  raw[row] = 0; // filter none
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);
    // 背景渐变 #0f1115 -> #16203a
    let r = Math.round(15 + 7 * t), g = Math.round(17 + 17 * t), b = Math.round(21 + 37 * t);
    const dx = x - W / 2, dy = y - H / 2, d = Math.sqrt(dx * dx + dy * dy);
    // 圆环 半径 150-170，蓝 #4f8cff
    if (d > 148 && d < 172) { r = 0x4f; g = 0x8c; b = 0xff; }
    // 中间两道斜白条，近似 W
    const inBar = (Math.abs(dx - 0.35 * dy) < 22 || Math.abs(dx + 0.35 * dy) < 22) && Math.abs(dy) < 110;
    if (inBar) { r = 0xe6; g = 0xe9; b = 0xef; }
    // 圆环与条纹相交处留白条优先（已处理）
    const i = row + 1 + x * 4;
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log('written', out, png.length, 'bytes');
