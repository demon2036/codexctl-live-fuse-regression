import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readProcessRow } from "../src/desktop-processes.mjs";

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ exclusive: true, host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法保留 loopback 端口");
  let released = false;
  return {
    port: address.port,
    async release() {
      if (released) return;
      released = true;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function createRunEnvelope({ base = os.tmpdir() } = {}) {
  if (!path.isAbsolute(base)) throw new Error("测试临时根必须是绝对路径");
  const temporary = await fs.mkdtemp(path.join(base, "codexctl-regression-"));
  // macOS exposes /var as a symlink to /private/var. Electron canonicalizes
  // user-data-dir before putting it on child command lines, so ownership must
  // use the same canonical spelling from the moment the envelope is created.
  const root = await fs.realpath(temporary);
  const profile = path.join(root, "profile");
  const runtime = path.join(root, "runtime");
  const results = path.join(root, "results");
  const reservation = await reserveLoopbackPort();
  await Promise.all([
    fs.mkdir(profile, { mode: 0o700 }),
    fs.mkdir(runtime, { mode: 0o700 }),
    fs.mkdir(results, { mode: 0o700 }),
  ]);
  let cleaned = false;
  const envelope = {
    port: reservation.port,
    processes: new Map(),
    profile,
    results,
    root,
    runId: randomUUID(),
    runtime,
    async releasePort() { await reservation.release(); },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await reservation.release();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
  return envelope;
}

export function assertSafeProfile(profile, { envelope, home = os.homedir() }) {
  const resolved = path.resolve(profile);
  if (!inside(envelope.root, resolved) || resolved === path.resolve(home)
    || inside(home, resolved)) {
    throw new Error(`拒绝生产 user-data-dir：${resolved}`);
  }
  return resolved;
}

export function registerOwnedProcess(envelope, record) {
  if (!Number.isSafeInteger(record?.pid) || record.pid < 2
    || typeof record.startedAt !== "string" || !record.startedAt
    || typeof record.command !== "string" || !record.command) {
    throw new Error("进程登记缺少 PID/start time/command");
  }
  const existing = envelope.processes.get(record.pid);
  if (existing && (existing.startedAt !== record.startedAt || existing.command !== record.command)) {
    throw new Error(`PID ${record.pid} 已绑定不同进程身份`);
  }
  const stored = Object.freeze({ ...record });
  envelope.processes.set(record.pid, stored);
  return stored;
}

export function verifyOwnedProcess(envelope, current, expectedPid = current?.pid) {
  if (current?.pid !== expectedPid) {
    throw new Error(`PID 不匹配：期望 ${expectedPid}，实际 ${current?.pid ?? "unknown"}`);
  }
  const expected = envelope.processes.get(expectedPid);
  if (!expected) throw new Error(`未知进程 PID ${expectedPid}`);
  if (current.startedAt !== expected.startedAt) {
    throw new Error(`start time 不匹配 PID ${expectedPid}`);
  }
  if (current.command !== expected.command) {
    throw new Error(`command 不匹配 PID ${expectedPid}`);
  }
  return expected;
}

export async function releaseExitedProcess(
  envelope,
  pid,
  { readProcess = readProcessRow } = {},
) {
  if (!envelope.processes.has(pid)) throw new Error(`未知进程 PID ${pid}`);
  if (await readProcess(pid)) throw new Error(`进程 PID ${pid} 尚未退出，不能解除归属`);
  envelope.processes.delete(pid);
}

export async function captureOwnedProcess(
  envelope,
  pid,
  { readProcess = readProcessRow } = {},
) {
  const row = await readProcess(pid);
  if (!row) throw new Error(`未知进程 PID ${pid}`);
  return registerOwnedProcess(envelope, row);
}

export async function cleanupRunEnvelope(
  envelope,
  { readProcess = readProcessRow, signal = process.kill.bind(process) } = {},
) {
  const refused = [];
  const terminated = [];
  for (const expected of envelope.processes.values()) {
    const current = await readProcess(expected.pid);
    if (!current) continue;
    try {
      verifyOwnedProcess(envelope, current, expected.pid);
      signal(expected.pid, "SIGTERM");
      terminated.push(expected.pid);
    } catch (error) {
      if (error.code !== "ESRCH") refused.push({ pid: expected.pid, reason: error.message });
    }
  }
  await envelope.cleanup();
  return { refused, terminated };
}
