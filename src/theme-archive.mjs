import { inflateRawSync } from "node:zlib";
import { ConfigError } from "./errors.mjs";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 32;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function archiveError(message) {
  return new ConfigError(`主题 ZIP 无效：${message}`);
}

function findEocd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw archiveError("找不到 ZIP central directory。" );
}

function safeArchiveName(rawName) {
  if (!rawName.length || rawName.some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw archiveError("文件名必须是可打印 ASCII。" );
  }
  const name = rawName.toString("ascii");
  if (name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)
    || name.split("/").some((part) => part === ".." || part === "." || part === "")) {
    if (!name.endsWith("/") || name.slice(0, -1).split("/").every((part) => part && part !== "." && part !== "..")) {
      throw archiveError(`不安全路径：${name}`);
    }
  }
  return name;
}

function normalizedFiles(entries) {
  const files = entries.filter((entry) => !entry.directory
    && !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith("/.DS_Store")
    && entry.name !== ".DS_Store");
  if (!files.length) throw archiveError("归档中没有主题文件。" );
  const split = files.map((entry) => entry.name.split("/"));
  const commonRoot = split.every((parts) => parts.length > 1 && parts[0] === split[0][0])
    ? split[0][0] : null;
  const result = new Map();
  for (const entry of files) {
    const name = commonRoot ? entry.name.slice(commonRoot.length + 1) : entry.name;
    if (!name || name.includes("/") || result.has(name.toLowerCase())) {
      throw archiveError(`主题包只能包含根目录 theme.json、theme.css 和一张图片：${name || entry.name}`);
    }
    result.set(name.toLowerCase(), { ...entry, name });
  }
  return result;
}

export function decodeThemeZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw archiveError(`大小必须在 22–${MAX_ARCHIVE_BYTES} bytes。`);
  }
  const eocd = findEocd(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralBytes = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentBytes = bytes.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries
    || totalEntries < 1 || totalEntries > MAX_ENTRIES
    || eocd + 22 + commentBytes !== bytes.length
    || centralOffset + centralBytes > eocd) {
    throw archiveError("不支持分卷、ZIP64、尾随数据或异常 entry 数量。" );
  }

  const entries = [];
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw archiveError("central directory entry 损坏。" );
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const entryDisk = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > bytes.length || entryDisk !== 0 || (flags & 1) !== 0
      || ![0, 8].includes(method) || compressedSize > MAX_ARCHIVE_BYTES
      || uncompressedSize > MAX_EXPANDED_BYTES) {
      throw archiveError("entry 使用了加密、不支持的压缩方式或异常大小。" );
    }
    const name = safeArchiveName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const directory = name.endsWith("/");
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0o170000;
    if (fileType === 0o120000 || (fileType && fileType !== 0o100000 && fileType !== 0o040000)) {
      throw archiveError(`不接受符号链接或特殊文件：${name}`);
    }
    if (!directory) expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw archiveError("解压后总大小超过 16 MiB。" );
    entries.push({
      name,
      directory,
      flags,
      method,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = end;
  }
  if (cursor !== centralOffset + centralBytes) throw archiveError("central directory 长度不一致。" );

  for (const entry of entries) {
    if (entry.directory) continue;
    const offset = entry.localOffset;
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
      throw archiveError(`local header 损坏：${entry.name}`);
    }
    const localFlags = bytes.readUInt16LE(offset + 6);
    const localMethod = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const localName = safeArchiveName(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (localName !== entry.name || localFlags !== entry.flags || localMethod !== entry.method
      || dataEnd > bytes.length || dataEnd > centralOffset) {
      throw archiveError(`local/central entry 不一致：${entry.name}`);
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    let content;
    try {
      content = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, {
        maxOutputLength: Math.min(MAX_EXPANDED_BYTES, entry.uncompressedSize + 1),
      });
    } catch {
      throw archiveError(`无法解压：${entry.name}`);
    }
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.expectedCrc) {
      throw archiveError(`大小或 CRC 不匹配：${entry.name}`);
    }
    entry.content = content;
  }
  return normalizedFiles(entries);
}

function dosTimestamp(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function encodeThemeZip(files) {
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_ENTRIES) {
    throw archiveError("导出文件数量无效。" );
  }
  const { time, day } = dosTimestamp();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const seen = new Set();
  for (const file of files) {
    const name = String(file.name ?? "");
    const nameBytes = Buffer.from(name, "ascii");
    if (!name || nameBytes.toString("ascii") !== name || name.includes("/") || name.includes("\\")
      || seen.has(name.toLowerCase())) throw archiveError(`导出文件名无效：${name}`);
    seen.add(name.toLowerCase());
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? "");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  const archive = Buffer.concat([...localParts, central, eocd]);
  if (archive.length > MAX_ARCHIVE_BYTES) throw archiveError("导出归档超过 32 MiB。" );
  return archive;
}
