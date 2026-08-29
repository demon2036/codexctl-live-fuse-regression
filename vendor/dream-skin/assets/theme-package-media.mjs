import { createHash } from "node:crypto";

export function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function detectedImageMedia(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString() === "RIFF"
    && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}
