import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { descendantProcessRows, listProcessRows } from "../src/desktop-processes.mjs";
import { percentile } from "./ab-sampler.mjs";

const execFileAsync = promisify(execFile);
const KINDS = ["main", "renderer", "other", "total"];
let clockTicksPromise = null;
// Match the A/B sampler's normalized system-load ceiling (0.9 per core).
// Lower ordinary desktop activity is retained in raw evidence and balanced
// by the O-I-I-O order; a genuinely saturated host invalidates the sample.
export const MAX_EXTERNAL_CPU_POINTS = os.cpus().length * 90;

function rounded(value) {
  return Number(value.toFixed(6));
}

export function cpuPercentDelta(before, after, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  const previous = new Map(before.map((entry) => [entry.pid, entry]));
  const current = new Map(after.map((entry) => [entry.pid, entry]));
  const result = { main: 0, other: 0, renderer: 0, total: 0 };
  for (const [pid, old] of previous) {
    const next = current.get(pid);
    if (!next || next.kind !== old.kind || !Number.isFinite(old.cpuSeconds)
      || !Number.isFinite(next.cpuSeconds) || next.cpuSeconds < old.cpuSeconds) return null;
    const percentage = (next.cpuSeconds - old.cpuSeconds) / (elapsedMs / 1000) * 100;
    result[old.kind] += percentage;
    result.total += percentage;
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, rounded(value)]));
}

export function readSystemCpuSnapshot() {
  return os.cpus().map(({ times }) => ({ ...times }));
}

export function systemCpuPercentDelta(before, after) {
  if (!Array.isArray(before) || before.length === 0 || before.length !== after?.length) return null;
  let busy = 0;
  let total = 0;
  for (let index = 0; index < before.length; index += 1) {
    const previous = before[index];
    const current = after[index];
    for (const key of ["user", "nice", "sys", "idle", "irq"]) {
      const delta = current?.[key] - previous?.[key];
      if (!Number.isFinite(delta) || delta < 0) return null;
      total += delta;
      if (key !== "idle") busy += delta;
    }
  }
  return total > 0 ? rounded(busy / total * before.length * 100) : null;
}

function parseCpuSeconds(value) {
  const match = String(value).match(/^(?:(\d+)-)?([\d:.]+)$/);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const parts = match[2].split(":").map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const hours = parts.length === 3 ? parts[0] : 0;
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const seconds = parts.at(-1);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function parseLinuxProcStat(value, clockTicks) {
  if (!Number.isFinite(clockTicks) || clockTicks <= 0) return null;
  const source = String(value);
  const open = source.indexOf("(");
  const close = source.lastIndexOf(")");
  const pid = Number(source.slice(0, open).trim());
  const fields = close > open ? source.slice(close + 1).trim().split(/\s+/) : [];
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isFinite(userTicks)
    || userTicks < 0 || !Number.isFinite(systemTicks) || systemTicks < 0) return null;
  return { cpuSeconds: rounded((userTicks + systemTicks) / clockTicks), pid };
}

async function linuxClockTicks() {
  clockTicksPromise ??= execFileAsync("/usr/bin/getconf", ["CLK_TCK"], {
    timeout: 3000, maxBuffer: 16 * 1024,
  }).then(({ stdout }) => {
    const value = Number(stdout.trim());
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid Linux CLK_TCK");
    return value;
  });
  return clockTicksPromise;
}

async function readLinuxCpuSnapshot(family, rootPid) {
  const clockTicks = await linuxClockTicks();
  const values = await Promise.all(family.map(async (row) => {
    const source = await fs.readFile(`/proc/${row.pid}/stat`, "utf8").catch(() => null);
    const parsed = source === null ? null : parseLinuxProcStat(source, clockTicks);
    if (!parsed) return null;
    return {
      ...parsed,
      kind: row.pid === rootPid ? "main"
        : row.command.includes("--type=renderer") ? "renderer" : "other",
    };
  }));
  return values.filter(Boolean);
}

export async function readOwnedCpuSnapshot(rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid < 2) throw new Error("Invalid owned root PID");
  const rows = await listProcessRows();
  const root = rows.find(({ pid }) => pid === rootPid);
  if (!root) throw new Error(`Owned root PID ${rootPid} disappeared`);
  const family = [root, ...descendantProcessRows(rows, rootPid)];
  if (process.platform === "linux") {
    const snapshot = await readLinuxCpuSnapshot(family, rootPid);
    if (!snapshot.some(({ pid }) => pid === rootPid)) throw new Error("Owned main CPU row was missing");
    return snapshot;
  }
  const byPid = new Map(family.map((row) => [row.pid, row]));
  const { stdout } = await execFileAsync("/bin/ps", [
    "-p", family.map(({ pid }) => pid).join(","), "-o", "pid=,time=",
  ], { timeout: 5000, maxBuffer: 256 * 1024, env: { ...process.env, LANG: "C", LC_ALL: "C" } });
  const snapshot = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+([^\s]+)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const row = byPid.get(pid);
    const cpuSeconds = parseCpuSeconds(match[2]);
    if (!row || !Number.isFinite(cpuSeconds)) continue;
    snapshot.push({
      cpuSeconds,
      kind: pid === rootPid ? "main"
        : row.command.includes("--type=renderer") ? "renderer" : "other",
      pid,
    });
  }
  if (!snapshot.some(({ pid }) => pid === rootPid)) throw new Error("Owned main CPU row was missing");
  return snapshot;
}

function summarize(raw) {
  return Object.fromEntries(KINDS.map((kind) => {
    const values = raw.map((entry) => entry[kind]);
    return [kind, {
      max: Math.max(...values),
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      values,
    }];
  }));
}

export async function sampleCpuSegment({
  action = null,
  durationMs,
  intervalMs = 500,
  maximumExternalCpu = Number.POSITIVE_INFINITY,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  snapshot,
  systemSnapshot = null,
} = {}) {
  if (typeof snapshot !== "function" || !Number.isFinite(durationMs) || durationMs < 100
    || durationMs > 60_000 || !Number.isFinite(intervalMs) || intervalMs < 50
    || intervalMs > durationMs || !(maximumExternalCpu >= 0)
    || (systemSnapshot !== null && typeof systemSnapshot !== "function")) {
    throw new Error("Invalid CPU sampler bounds");
  }
  let actionDone = action === null;
  let actionError = null;
  let actionResult = null;
  const actionPromise = action === null ? null : Promise.resolve().then(action).then(
    (value) => { actionDone = true; actionResult = value; },
    (error) => { actionDone = true; actionError = error; },
  );
  let previous = await snapshot();
  let previousSystem = systemSnapshot ? await systemSnapshot() : null;
  let previousAt = now();
  const deadline = previousAt + durationMs;
  const raw = [];
  let invalid = false;
  while (now() < deadline && (!actionDone || raw.length < 2 || action === null)) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
    const currentAt = now();
    const current = await snapshot();
    const currentSystem = systemSnapshot ? await systemSnapshot() : null;
    const delta = cpuPercentDelta(previous, current, currentAt - previousAt);
    const systemCpu = systemSnapshot ? systemCpuPercentDelta(previousSystem, currentSystem) : null;
    if (!delta || (systemSnapshot && systemCpu === null)) invalid = true;
    else raw.push({
      atMs: rounded(currentAt),
      ...delta,
      ...(systemSnapshot ? {
        externalCpu: rounded(Math.max(0, systemCpu - delta.total)),
        systemCpu,
      } : {}),
    });
    previous = current;
    previousSystem = currentSystem;
    previousAt = currentAt;
    if (action === null && now() >= deadline) break;
  }
  await actionPromise;
  if (actionError) throw actionError;
  const externalP95 = systemSnapshot ? percentile(raw.map(({ externalCpu }) => externalCpu), 0.95) : null;
  const summary = raw.length >= 2 ? summarize(raw) : null;
  if (invalid || raw.length < 2 || (action !== null && !actionDone)
    || (externalP95 !== null && externalP95 > maximumExternalCpu)) {
    return { actionResult, externalP95, raw,
      reasonCode: externalP95 > maximumExternalCpu ? "high-external-load" : "invalid-sample",
      status: "invalid", summary };
  }
  return { actionResult, externalP95, raw, status: "pass", summary };
}
