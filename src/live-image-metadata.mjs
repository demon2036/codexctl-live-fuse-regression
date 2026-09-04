import { classifyImageDimensions } from "../vendor/dream-skin/scripts/image-metadata.mjs";

const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function u16be(bytes, offset = 0) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function u16le(bytes, offset = 0) {
  return bytes[offset] + bytes[offset + 1] * 256;
}

function u24le(bytes, offset = 0) {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}

function u32be(bytes, offset = 0) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function u32le(bytes, offset = 0) {
  return bytes[offset] + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

async function readAt(handle, position, length) {
  const bytes = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(bytes, 0, length, position);
  return bytes.subarray(0, bytesRead);
}

class Cursor {
  constructor(handle, size) {
    this.handle = handle;
    this.size = size;
    this.position = 0;
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }

  async byte() {
    if (this.offset >= this.buffer.length) {
      this.buffer = await readAt(this.handle, this.position, Math.min(4096, this.size - this.position));
      this.offset = 0;
      if (this.buffer.length === 0) return null;
    }
    this.position += 1;
    return this.buffer[this.offset++];
  }

  skip(count) {
    if (!Number.isSafeInteger(count) || count < 0 || this.position + count > this.size) return false;
    this.position += count;
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
    return true;
  }
}

async function png(handle) {
  const bytes = await readAt(handle, 0, 24);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length !== 24 || signature.some((value, index) => bytes[index] !== value)
    || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

async function jpeg(handle, size) {
  const cursor = new Cursor(handle, size);
  if (await cursor.byte() !== 0xff || await cursor.byte() !== 0xd8) return null;
  while (cursor.position < size) {
    let prefix = await cursor.byte();
    while (prefix !== null && prefix !== 0xff) prefix = await cursor.byte();
    if (prefix === null) return null;
    let marker = await cursor.byte();
    while (marker === 0xff) marker = await cursor.byte();
    if (marker === null || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const high = await cursor.byte();
    const low = await cursor.byte();
    if (high === null || low === null) return null;
    const length = high * 256 + low;
    if (length < 2 || cursor.position + length - 2 > size) return null;
    if (SOF.has(marker) && length >= 7) {
      const fields = await readAt(handle, cursor.position, 5);
      if (fields.length !== 5) return null;
      return { width: u16be(fields, 3), height: u16be(fields, 1) };
    }
    if (!cursor.skip(length - 2)) return null;
  }
  return null;
}

async function webp(handle, size) {
  const header = await readAt(handle, 0, 12);
  if (header.length !== 12 || ascii(header, 0, 4) !== "RIFF"
    || ascii(header, 8, 4) !== "WEBP") return null;
  const end = Math.min(size, u32le(header, 4) + 8);
  let offset = 12;
  while (offset + 8 <= end) {
    const chunk = await readAt(handle, offset, 18);
    if (chunk.length < 8) return null;
    const type = ascii(chunk, 0, 4);
    const length = u32le(chunk, 4);
    if (offset + 8 + length > end) return null;
    if (type === "VP8X" && length >= 10 && chunk.length >= 18) {
      return { width: u24le(chunk, 12) + 1, height: u24le(chunk, 15) + 1 };
    }
    if (type === "VP8L" && length >= 5 && chunk.length >= 13 && chunk[8] === 0x2f) {
      return {
        width: 1 + chunk[9] + ((chunk[10] & 0x3f) << 8),
        height: 1 + (chunk[10] >> 6) + (chunk[11] << 2) + ((chunk[12] & 0x0f) << 10),
      };
    }
    if (type === "VP8 " && length >= 10 && chunk.length >= 18
      && chunk[11] === 0x9d && chunk[12] === 0x01 && chunk[13] === 0x2a) {
      return { width: u16le(chunk, 14) & 0x3fff, height: u16le(chunk, 16) & 0x3fff };
    }
    offset += 8 + length + (length % 2);
  }
  return null;
}

export async function readLiveImageMetadata(handle, extension, size) {
  const normalized = String(extension).toLowerCase();
  const dimensions = normalized === ".png" ? await png(handle)
    : normalized === ".jpg" || normalized === ".jpeg" ? await jpeg(handle, size)
      : normalized === ".webp" ? await webp(handle, size) : null;
  return dimensions ? classifyImageDimensions(dimensions) : null;
}
