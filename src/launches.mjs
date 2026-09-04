import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { listDesktopProcesses } from "./desktop-processes.mjs";
import { ensurePrivateDirectory, writeTextAtomic } from "./util.mjs";

export function connectionFingerprint(relay) {
  if (!relay?.enabled) return "official";
  return createHash("sha256").update(JSON.stringify({
    mode: "relay",
    url: relay.values.url,
    apiKey: relay.values.apiKey,
    proxy: relay.values.proxy,
    websockets: relay.values.websockets,
    standaloneWebSearch: relay.values.standaloneWebSearch,
  })).digest("hex");
}

function recordFile(paths, pid) {
  return path.join(paths.launchesDir, `${pid}.json`);
}

export function selectPrimaryManagedLaunch(records) {
  if (!Array.isArray(records)) return null;
  return records.find((record) => record && !record.isolatedProfile) ?? null;
}

export async function waitForDesktopProcess(desktop, pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await listDesktopProcesses(desktop)).find((entry) => entry.pid === pid);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function recordManagedLaunch(paths, plan, processInfo, relay, config, options = {}) {
  await ensurePrivateDirectory(paths.launchesDir);
  const record = {
    schema: "codexctl-launch/1",
    pid: processInfo.pid,
    startedAt: processInfo.startedAt,
    executable: plan.executable,
    connection: {
      mode: relay.enabled ? "relay" : "official",
      fingerprint: connectionFingerprint(relay),
      verified: relay.enabled ? options.relayVerified === true : true,
    },
    injection: {
      enabled: plan.injectionEnabled,
      transport: plan.injectionTransport ?? null,
      port: plan.debugPort || null,
      modules: { ...config.modules },
    },
    live: options.liveSession ? {
      enabled: true,
      hostRevision: options.liveSession.hostRevision,
      sessionId: options.liveSession.sessionId,
    } : { enabled: false, hostRevision: null, sessionId: null },
    isolatedProfile: options.isolatedProfile ? path.resolve(options.isolatedProfile) : null,
    createdAt: new Date().toISOString(),
  };
  await writeTextAtomic(recordFile(paths, processInfo.pid), `${JSON.stringify(record, null, 2)}\n`, 0o600);
  return record;
}

export async function removeManagedLaunch(paths, pid) {
  await fs.rm(recordFile(paths, pid), { force: true });
}

export async function readManagedLaunches(paths, desktop, { prune = false } = {}) {
  await ensurePrivateDirectory(paths.launchesDir);
  const live = new Map((await listDesktopProcesses(desktop)).map((row) => [row.pid, row]));
  const records = [];
  for (const entry of await fs.readdir(paths.launchesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d+\.json$/.test(entry.name)) continue;
    const filename = path.join(paths.launchesDir, entry.name);
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(filename, "utf8"));
    } catch {}
    const processInfo = live.get(record?.pid);
    const valid = record?.schema === "codexctl-launch/1"
      && Number.isSafeInteger(record.pid)
      && typeof record.startedAt === "string"
      && processInfo?.startedAt === record.startedAt;
    if (valid) records.push(record);
    else if (prune) await fs.rm(filename, { force: true }).catch(() => {});
  }
  return records;
}

export async function managedRecordForProcess(paths, desktop, processInfo) {
  const records = await readManagedLaunches(paths, desktop, { prune: true });
  return records.find((record) => record.pid === processInfo.pid
    && record.startedAt === processInfo.startedAt) ?? null;
}

export async function processInfoForPid(desktop, pid) {
  return (await listDesktopProcesses(desktop)).find((entry) => entry.pid === pid) ?? null;
}
