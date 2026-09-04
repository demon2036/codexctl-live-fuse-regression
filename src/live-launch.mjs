import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ConfigError } from "./errors.mjs";
import { liveHostRevision } from "./live-artifacts.mjs";
import { connectLiveHost } from "./live-host-client.mjs";
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
  terminateDesktopProcess,
  terminateProfileCrashHandlers,
} from "./desktop-processes.mjs";
import { recordManagedLaunch, removeManagedLaunch, waitForDesktopProcess } from "./launches.mjs";
import { openPrivateLog } from "./logs.mjs";
import { planLiveAppLaunch } from "./live-platform.mjs";
import { discoverDesktop, launchApp } from "./platform.mjs";
import { sanitizedBaseEnvironment } from "./relay.mjs";

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

function validateWorkerEvent(value, sessionId) {
  if (!value || value.schema !== "codexctl-live-worker-event/1"
    || value.sessionId !== undefined && value.sessionId !== sessionId
    || !["ready", "paired", "error"].includes(value.phase)) {
    throw new Error("live companion worker event is invalid");
  }
  return value;
}

async function spawnCompanion(paths, bootstrapFile, env) {
  const log = await openPrivateLog(paths.liveCompanionLogFile);
  let child;
  try {
    child = spawn(process.execPath, [paths.liveCompanionWorker], {
      detached: true,
      env: {
        ...sanitizedBaseEnvironment(env),
        CODEXCTL_HOME: paths.home,
        CODEXCTL_LIVE_BOOTSTRAP: bootstrapFile,
      },
      stdio: ["ignore", log.fd, log.fd, "ipc"],
    });
    child.unref();
  } finally {
    await log.close();
  }
  const events = [];
  const waiters = [];
  let exit = null;
  child.on("message", (value) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(value);
    else events.push(value);
  });
  child.once("exit", (code, signal) => {
    exit = { code, signal };
    for (const waiter of waiters.splice(0)) {
      waiter.reject(new Error(`live companion exited before pairing (${code ?? signal})`));
    }
  });
  child.once("error", (error) => {
    exit = { code: null, signal: "spawn-error" };
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });
  return {
    child,
    next(timeoutMs = 30_000) {
      if (events.length) return Promise.resolve(events.shift());
      if (exit) return Promise.reject(new Error("live companion already exited"));
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(value) { clearTimeout(timer); resolve(value); },
          reject(error) { clearTimeout(timer); reject(error); },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("live companion startup timed out"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function terminateCompanion(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = new Promise((resolve) => setTimeout(resolve, 3000, "timeout"));
  if (await Promise.race([exited, timer]) === "timeout" && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
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
    if (current.live) return current.session.app.pid;
  } catch {}
  let connection = null;
  try {
    connection = await connectLiveHost({
      authToken: bootstrap.authToken,
      hostRevision: bootstrap.hostRevision,
      sessionId: bootstrap.sessionId,
      socketPath: bootstrap.hostSocketPath,
      timeoutMs: 500,
    });
    return connection.host.pid;
  } catch { return null; } finally { connection?.close(); }
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
      if (!await fs.stat(bootstrap.hostSocketPath).then((stat) => stat.isSocket()).catch(() => false)) {
        return null;
      }
      const appPid = await reconnectBootstrapAppPid(paths, bootstrap);
      return conflicts.some((row) => row.pid === appPid) ? bootstrap : null;
    } catch { return null; }
  }))).filter(Boolean);
  if (matches.length > 1) throw new ConfigError("发现多个可重连 live host；拒绝猜测目标。");
  return matches[0] ?? null;
}

async function reconnectCompanion(paths, desktop, conflicts, bootstrap, env) {
  if (await liveHostRevision(paths) !== bootstrap.hostRevision) {
    throw new ConfigError("运行中的 live host 版本已过期；不能假装热升级宿主核心。");
  }
  const worker = await spawnCompanion(paths, liveBootstrapFile(paths, bootstrap.sessionId), env);
  try {
    const ready = validateWorkerEvent(await worker.next(), bootstrap.sessionId);
    if (ready.phase !== "ready") throw new Error(ready.message || "live companion prepare failed");
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
  const bootstrap = {
    ...identity,
    cliSocketPath: liveSocketPath(paths, identity.sessionId),
    companionLogFile: paths.liveCompanionLogFile,
    controllerHome: paths.home,
    createdAt: new Date().toISOString(),
    desktop: {
      bundle: desktop.bundle,
      executable: await fs.realpath(desktop.executable).catch(() => desktop.executable),
      identity: `${desktop.bundle ? "bundle" : "package"}:${desktopIdentityPath}`,
    },
    hostRevision: await liveHostRevision(paths),
    hostSocketPath: liveHostSocketPath(paths, identity.sessionId),
    schema: "codexctl-live-bootstrap/1",
  };
  const plan = await planLiveAppLaunch(config, paths, relay, bootstrapFilename, {
    hidden: options.hidden,
    isolatedProfile,
    proxyServer: options.proxyServer,
    officialCliSource: options.officialCliSource,
  }, env, platform);
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
      await terminateDesktopProcess(processInfo, desktop, 5000).catch(() => false);
      if (isolatedProfile) {
        await terminateProfileCrashHandlers(isolatedProfile, desktop).catch(() => []);
      }
      await removeManagedLaunch(paths, processInfo.pid).catch(() => {});
    }
    await removeLiveBootstrap(paths, identity.sessionId, identity.authToken).catch(() => {});
    throw error;
  }
}
