import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UsageError } from "./errors.mjs";

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function parseBoolean(value, name = "value") {
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new UsageError(`${name} 必须是 true/false。`);
}

export function parseTokenCount(value, name = "token 数") {
  const normalized = String(value).trim().toLowerCase().replaceAll("_", "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) throw new UsageError(`${name} 无效：${value}`);
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(parsed)) throw new UsageError(`${name} 必须是整数 token 数。`);
  return parsed;
}

export function formatTokenCount(value) {
  if (value == null) return "native";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

export function assertId(value, label = "id") {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) {
    throw new UsageError(`${label} 只能包含字母、数字、点、下划线和短横线，长度 1–80。`);
  }
  return id;
}

export function parseUnit(value, name, { signed = false } = {}) {
  const parsed = Number(value);
  const minimum = signed ? -1 : 0;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > 1) {
    throw new UsageError(`${name} 必须在 ${minimum} 到 1 之间。`);
  }
  return parsed;
}

export async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => {});
}

export async function writeTextAtomic(filename, text, mode = 0o600) {
  await ensurePrivateDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", mode);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filename);
    await fs.chmod(filename, mode).catch(() => {});
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function writeTextIfChanged(filename, text, mode = 0o600) {
  try {
    if (await fs.readFile(filename, "utf8") === text) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeTextAtomic(filename, text, mode);
  return true;
}

export async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize state mutations across concurrent CLI invocations.  The lock is
 * recoverable only when its owner is gone (or the record is unreadable and
 * old), so a slow but live writer is never stolen.
 */
export async function withFileLock(filename, action, {
  timeoutMs = 8000,
  staleMs = 60_000,
} = {}) {
  await ensurePrivateDirectory(path.dirname(filename));
  const deadline = Date.now() + timeoutMs;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  let handle = null;
  while (!handle) {
    try {
      handle = await fs.open(filename, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        schema: "codexctl-lock/1",
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      })}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      handle = null;
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const [record, stat] = await Promise.all([
          fs.readFile(filename, "utf8").then(JSON.parse),
          fs.stat(filename),
        ]);
        stale = !processExists(Number(record.pid)) && Date.now() - stat.mtimeMs >= 250;
      } catch {
        const stat = await fs.stat(filename).catch(() => null);
        stale = Boolean(stat && Date.now() - stat.mtimeMs > staleMs);
      }
      if (stale) {
        await fs.rm(filename, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`等待状态锁超时：${filename}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    try {
      const record = JSON.parse(await fs.readFile(filename, "utf8"));
      if (record.token === token) await fs.rm(filename, { force: true });
    } catch {}
  }
}

export function redactSecret(value) {
  if (!value) return null;
  return `<redacted:${String(value).length}>`;
}
