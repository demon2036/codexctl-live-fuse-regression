import fs from "node:fs/promises";
import path from "node:path";
import { ensurePrivateDirectory } from "./util.mjs";

export async function rotateLog(filename, {
  maximumBytes = 5 * 1024 * 1024,
  keep = 3,
} = {}) {
  let stat;
  try {
    stat = await fs.stat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (stat.size < maximumBytes) {
    await fs.chmod(filename, 0o600).catch(() => {});
    return false;
  }
  for (let index = keep; index >= 1; index -= 1) {
    const source = index === 1 ? filename : `${filename}.${index - 1}`;
    const destination = `${filename}.${index}`;
    if (index === keep) await fs.rm(destination, { force: true }).catch(() => {});
    await fs.rename(source, destination).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return true;
}

export async function openPrivateLog(filename, options = {}) {
  await ensurePrivateDirectory(path.dirname(filename));
  await rotateLog(filename, options);
  const handle = await fs.open(filename, "a", 0o600);
  await fs.chmod(filename, 0o600).catch(() => {});
  return handle;
}
