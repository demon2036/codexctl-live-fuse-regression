import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "./errors.mjs";
import { updateRuntimeConfig } from "./runtime.mjs";

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function extractOption(args, name, { multiple = false, inline = false } = {}) {
  const values = [];
  for (let index = 0; index < args.length;) {
    if (args[index] === name) {
      if (index + 1 >= args.length) throw new UsageError(`${name} 缺少值。`);
      values.push(args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    const prefix = `${name}=`;
    if (!inline || !args[index].startsWith(prefix)) { index += 1; continue; }
    const value = args[index].slice(prefix.length);
    if (!value) throw new UsageError(`${name} 缺少值。`);
    values.push(value);
    args.splice(index, 1);
  }
  return multiple ? values : values.at(-1);
}

export function extractFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  if (args.includes(name)) throw new UsageError(`重复的选项：${name}`);
  return true;
}

export function assertNoArgs(args, usage) {
  if (args.length) throw new UsageError(`${usage}\n未知参数：${args.join(" ")}`);
}

export async function canonicalFile(filename, maximumBytes, kind) {
  const canonical = await fs.realpath(path.resolve(filename)).catch((error) => {
    if (error.code === "ENOENT") throw new UsageError(`${kind} 文件不存在：${filename}`);
    throw error;
  });
  const stat = await fs.stat(canonical);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
    throw new UsageError(`${kind} 文件大小必须在 1–${maximumBytes} bytes。`);
  }
  return canonical;
}

export async function updateControllerConfig(paths, mutator) {
  // Renderer state is intentionally never hot-mutated. The matching runtime
  // is committed atomically and becomes active on the next `codexctl app`.
  return updateRuntimeConfig(paths, mutator);
}
