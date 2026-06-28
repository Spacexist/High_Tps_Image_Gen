// 使用 Node 内置 zlib 构造固定 PNG，避免测试服务依赖图片文件或第三方包。
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const GLYPHS = {
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function setPixel(raw, size, x, y, red, green, blue) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  raw[offset] = red;
  raw[offset + 1] = green;
  raw[offset + 2] = blue;
  raw[offset + 3] = 255;
}

function fillRect(raw, size, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(raw, size, column, row, ...color);
    }
  }
}

function drawWord(raw, size, word) {
  const scale = Math.max(8, Math.floor(size / 28));
  const letterWidth = 5 * scale;
  const gap = scale;
  const totalWidth = word.length * letterWidth + (word.length - 1) * gap;
  const startX = Math.floor((size - totalWidth) / 2);
  const startY = Math.floor((size - 7 * scale) / 2);

  [...word].forEach((letter, letterIndex) => {
    const glyph = GLYPHS[letter];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel !== "1") return;
        fillRect(
          raw,
          size,
          startX + letterIndex * (letterWidth + gap) + columnIndex * scale,
          startY + rowIndex * scale,
          scale,
          scale,
          [15, 18, 20],
        );
      });
    });
  });
}

export function createTestPng(size = 512) {
  if (!Number.isInteger(size) || size < 128 || size > 2048) {
    throw new Error("imageSize must be an integer between 128 and 2048");
  }

  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size, 255);

  // 每行首字节是 PNG filter type；0 表示不使用过滤器。
  for (let row = 0; row < size; row += 1) raw[row * rowLength] = 0;

  const border = Math.max(4, Math.floor(size / 100));
  fillRect(raw, size, 0, 0, size, border, [184, 255, 44]);
  fillRect(raw, size, 0, size - border, size, border, [184, 255, 44]);
  fillRect(raw, size, 0, 0, border, size, [184, 255, 44]);
  fillRect(raw, size, size - border, 0, border, size, [184, 255, 44]);
  drawWord(raw, size, "TEST");

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
