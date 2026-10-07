import fs from "node:fs/promises";
import path from "node:path";
import { ConfigError } from "./errors.mjs";
import { liveHostRevision } from "./live-artifacts.mjs";
import {
  liveBootstrapFile,
  readLiveBootstrap,
  removeLiveBootstrap,
  writeLiveBootstrap,
} from "./live-bootstrap.mjs";
import { newLiveIdentity } from "./live-protocol.mjs";
import { inspectLiveSession, liveHostSocketPath, liveSocketPath } from "./live-session.mjs";
import {
  listDesktopProcesses,
} from "./desktop-processes.mjs";
import { recordManagedLaunch, removeManagedLaunch, waitForDesktopProcess } from "./launches.mjs";
import { planLiveAppLaunch } from "./live-platform.mjs";
import { discoverDesktop, launchApp } from "./platform.mjs";
import { spawnCompanion, terminateCompanion, validateWorkerEvent } from "./live-worker.mjs";

function hasProfile(command, profile) {
  const normalized = path.resolve(profile);
  return String(command).includes(`--user-data-dir=${normalized}`)
    || String(command).includes(`--user-data-dir ${normalized}`);
}

export function liveStartConflicts(running, isolatedProfile = null) {
  return isolatedProfile
    ? running.filter((row) => hasProfile(row.command, isolatedProfile))
    : running.filter((row) => !/--user-data-dir(?:=|\s)/.test(row.command));
}

async function waitForLaunched(desktop, launched, isolatedProfile, timeoutMs = 10_000) {
  if (launched.pid) return waitForDesktopProcess(desktop, launched.pid, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = (await listDesktopProcesses(desktop)).filter((row) => (
      isolatedProfile ? hasProfile(row.command, isolatedProfile) : !/--user-data-dir(?:=|\s)/.test(row.command)
    ));
    if (candidates.length === 1) return candidates[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function reconnectBootstrapAppPid(paths, bootstrap) {
  try {
    const current = await inspectLiveSession(paths, bootstrap.sessionId);
    if (current.live || current.processes.app) return current.session.app.pid;
  } catch {}
  return null;
}

async function reconnectBootstrap(paths, desktop, conflicts) {
  let entries;
  try { entries = await fs.readdir(paths.liveBootstrapsDir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const executable = await fs.realpath(desktop.executable).catch(() => desktop.executable);
  const matches = (await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) return null;
    try {
      const bootstrap = await readLiveBootstrap(path.join(paths.liveBootstrapsDir, entry.name));
      if (bootstrap.desktop.executable !== executable) return null;
      const appPid = await reconnectBootstrapAppPid(paths, bootstrap);
      return conflicts.some((row) => row.pid === appPid) ? bootstrap : null;
    } catch { return null; }
  }))).filter(Boolean);
  if (matches.length > 1) throw new ConfigError("发现多个可重连 live host；拒绝猜测目标。");
  return matches[0] ?? null;
}

async function reconnectCompanion(paths, desktop, conflicts, bootstrap, env) {
  const worker = await spawnCompanion(paths, liveBootstrapFile(paths, bootstrap.sessionId), env);
  try {
    const ready = validateWorkerEvent(await worker.next(), bootstrap.sessionId);
    if (ready.phase !== "ready") throw new Error(ready.message || "live companion prepare failed");
    const appPid = await reconnectBootstrapAppPid(paths, bootstrap);
    if (!appPid || !conflicts.some((row) => row.pid === appPid)) {
      throw new Error("live companion rebind App identity is unavailable");
    }
    worker.launch({ appPid, debugPort: bootstrap.debugPort, sessionId: bootstrap.sessionId });
    const paired = validateWorkerEvent(await worker.next(), bootstrap.sessionId);
    if (paired.phase !== "paired" || paired.companionPid !== worker.child.pid
      || !conflicts.some((row) => row.pid === paired.appPid)) {
      throw new Error(paired.message || "live companion rebind failed");
    }
    return {
      action: "reconnected",
      companionPid: paired.companionPid,
      desktop,
      hostRevision: bootstrap.hostRevision,
      plan: null,
      processInfo: conflicts.find((row) => row.pid === paired.appPid),
      record: null,
      sessionId: bootstrap.sessionId,
    };
  } catch (error) {
    await terminateCompanion(worker.child).catch(() => {});
    throw error;
  }
}

async function reuseLiveCompanion(paths, desktop, conflicts, bootstrap) {
  try {
    const current = await inspectLiveSession(paths, bootstrap.sessionId);
    if (!current.live || !conflicts.some((row) => row.pid === current.session.app.pid)) return null;
    return {
      action: "reused",
      companionPid: current.session.companion.pid,
      desktop,
      hostRevision: bootstrap.hostRevision,
      plan: null,
      processInfo: conflicts.find((row) => row.pid === current.session.app.pid),
      record: null,
      sessionId: bootstrap.sessionId,
    };
  } catch { return null; }
}

export async function startLiveApp({
  paths,
  config,
  relay = { enabled: false, values: {} },
  options = {},
  env = process.env,
  platform = process.platform,
}) {
  const desktop = await discoverDesktop(config, env, platform);
  const isolatedProfile = options.isolatedProfile ? path.resolve(options.isolatedProfile) : null;
  if (isolatedProfile) await fs.mkdir(isolatedProfile, { recursive: true, mode: 0o700 });
  const running = await listDesktopProcesses(desktop);
  const conflicts = liveStartConflicts(running, isolatedProfile);
  if (conflicts.length) {
    const reconnect = await reconnectBootstrap(paths, desktop, conflicts);
    if (reconnect) {
      return await reuseLiveCompanion(paths, desktop, conflicts, reconnect)
        ?? reconnectCompanion(paths, desktop, conflicts, reconnect, env);
    }
    throw new ConfigError("已有目标 Codex App；live start 不会接管、关闭或替换它。");
  }
  const identity = newLiveIdentity();
  const bootstrapFilename = liveBootstrapFile(paths, identity.sessionId);
  const desktopIdentityPath = await fs.realpath(desktop.bundle ?? desktop.executable)
    .catch(() => desktop.bundle ?? desktop.executable);
  const hostRevision = await liveHostRevision(paths);
  const plan = await planLiveAppLaunch(config, paths, relay, bootstrapFilename, {
    hidden: options.hidden,
    isolatedProfile,
    proxyServer: options.proxyServer,
    officialCliSource: options.officialCliSource,
  }, env, platform);
  const bootstrap = {
    ...identity,
    cliSocketPath: liveSocketPath(paths, identity.sessionId),
    companionLogFile: paths.liveCompanionLogFile,
    controllerHome: paths.home,
    createdAt: new Date().toISOString(),
    debugPort: plan.debugPort,
    desktop: {
      bundle: desktop.bundle,
      executable: await fs.realpath(desktop.executable).catch(() => desktop.executable),
      identity: `${desktop.bundle ? "bundle" : "package"}:${desktopIdentityPath}`,
    },
    hostRevision,
    hostSocketPath: liveHostSocketPath(paths, identity.sessionId),
    schema: "codexctl-live-bootstrap/1",
    transport: plan.liveTransport,
  };
  let worker = null;
  let processInfo = null;
  let record = null;
  await writeLiveBootstrap(paths, bootstrap);
  try {
    worker = await spawnCompanion(paths, bootstrapFilename, env);
    const ready = validateWorkerEvent(await worker.next(), identity.sessionId);
    if (ready.phase === "error") throw new Error(ready.message);
    if (ready.phase !== "ready") throw new Error("live companion did not prepare before App launch");
    const launched = await launchApp(plan);
    processInfo = await waitForLaunched(desktop, launched, isolatedProfile);
    if (!processInfo) throw new Error("live App process did not remain running");
    worker.launch({
      appPid: processInfo.pid,
      debugPort: bootstrap.debugPort,
      sessionId: identity.sessionId,
    });
    const paired = validateWorkerEvent(await worker.next(), identity.sessionId);
    if (paired.phase === "error") throw new Error(paired.message);
    if (paired.phase !== "paired" || paired.appPid !== processInfo.pid
      || paired.companionPid !== worker.child.pid) {
      throw new Error("live App and companion pairing did not match launched processes");
    }
    record = await recordManagedLaunch(paths, plan, processInfo, relay, config, {
      isolatedProfile,
      liveSession: { hostRevision: bootstrap.hostRevision, sessionId: identity.sessionId },
    });
    return {
      action: "launched",
      companionPid: worker.child.pid,
      desktop,
      hostRevision: bootstrap.hostRevision,
      plan,
      processInfo,
      record,
      sessionId: identity.sessionId,
    };
  } catch (error) {
    await terminateCompanion(worker?.child).catch(() => {});
    if (processInfo) {
      await removeManagedLaunch(paths, processInfo.pid).catch(() => {});
    }
    await removeLiveBootstrap(paths, identity.sessionId, identity.authToken).catch(() => {});
    if (processInfo && error instanceof Error) {
      error.message += `; Codex App PID ${processInfo.pid} 保持运行，codexctl 未终止它`;
    }
    throw error;
  }
}
