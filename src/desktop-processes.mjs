import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  descendantProcessRows,
  listProcessRows,
  processIdentityKey,
  readProcessRow,
  readPs,
} from "./process-table.mjs";

export {
  descendantProcessRows,
  listProcessRows,
  parseProcessRows,
  processCommand,
  processIdentityKey,
  processStartToken,
  readProcessRow,
} from "./process-table.mjs";

const execFileAsync = promisify(execFile);

export function desktopCommandMatches(command, executable) {
  return command === executable || command.startsWith(`${executable} `);
}

export function remoteDebuggingPort(command) {
  const match = String(command).match(
    /(?:^|\s)--remote-debugging-port(?:=|\s+)(\d+)(?:\s|$)/,
  );
  if (!match) return 0;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 0;
}

export function preservedLaunchArgs(command) {
  const source = String(command);
  const values = [];
  const ozone = source.match(/(?:^|\s)--ozone-platform(?:=|\s+)(wayland|x11)(?:\s|$)/);
  if (ozone) values.push(`--ozone-platform=${ozone[1]}`);
  return values;
}

export async function listDesktopProcesses(desktop) {
  return (await listProcessRows()).filter((row) =>
    desktopCommandMatches(row.command, desktop.executable),
  );
}

export async function desktopProcessMatches(processInfo, desktop) {
  const row = await readProcessRow(processInfo.pid).catch(() => null);
  return row !== null
    && desktopCommandMatches(row.command, desktop.executable)
    && row.startedAt === processInfo.startedAt;
}

export function detachedDesktopHelperCommandMatches(command, desktop) {
  if (!desktop?.bundle) return false;
  const bundle = path.resolve(desktop.bundle);
  const modifierMonitor = path.join(
    bundle,
    "Contents",
    "Resources",
    "native",
    "bare-modifier-monitor",
  );
  const value = String(command);
  const appServer = path.join(bundle, "Contents", "Resources", "codex");
  return value === modifierMonitor
    || value.startsWith(`${modifierMonitor} `)
    || value === `${appServer} app-server`
    || value.startsWith(`${appServer} app-server `)
    || (value.startsWith(`${path.join(bundle, "Contents", "Frameworks")}${path.sep}`)
      && value.includes(`${path.sep}browser_crashpad_handler `));
}

export function relatedMacDesktopBundles(desktop) {
  if (!desktop?.bundle) return [];
  const bundle = path.resolve(desktop.bundle);
  const name = path.basename(bundle);
  if (!new Set(["Codex.app", "ChatGPT.app"]).has(name)) return [bundle];
  const parent = path.dirname(bundle);
  return [...new Set([
    bundle,
    path.join(parent, "Codex.app"),
    path.join(parent, "ChatGPT.app"),
  ])];
}

export function desktopMainCommandMatchesBundle(command, bundle) {
  const root = path.resolve(bundle);
  return ["ChatGPT", "Codex"].some((name) => desktopCommandMatches(
    String(command),
    path.join(root, "Contents", "MacOS", name),
  ));
}

export async function listDetachedDesktopHelpers(desktop) {
  if (!desktop?.bundle) return [];
  const rows = await listProcessRows();
  return detachedDesktopHelperRows(rows, desktop);
}

export function detachedDesktopHelperRows(rows, desktop) {
  return relatedMacDesktopBundles(desktop).flatMap((bundle) => {
    const mainRows = rows.filter((row) => desktopMainCommandMatchesBundle(row.command, bundle));
    const mainPids = new Set(mainRows.map((row) => row.pid));
    const familyPids = new Set(mainPids);
    for (const main of mainRows) {
      for (const descendant of descendantProcessRows(rows, main.pid)) familyPids.add(descendant.pid);
    }
    const monitor = path.join(bundle, "Contents", "Resources", "native", "bare-modifier-monitor");
    const appServer = path.join(bundle, "Contents", "Resources", "codex");
    const frameworks = path.join(bundle, "Contents", "Frameworks") + path.sep;
    return rows.filter((row) => {
      const command = String(row.command);
      if (command === monitor || command.startsWith(`${monitor} `)) {
        return !familyPids.has(row.ppid);
      }
      if (command === `${appServer} app-server` || command.startsWith(`${appServer} app-server `)) {
        return !familyPids.has(row.ppid);
      }
      return mainPids.size === 0 && command.startsWith(frameworks)
        && command.includes(`${path.sep}browser_crashpad_handler `);
    });
  });
}

async function requestMacDesktopQuit(pid) {
  const script = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid})`,
    'if (!app) throw new Error("desktop process disappeared")',
    'if (!app.terminate()) throw new Error("desktop application rejected terminate")',
  ].join("; ");
  await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 3000,
    maxBuffer: 64 * 1024,
  });
}

export async function processHasRelayOverride(pid, platform = process.platform) {
  let environment = "";
  try {
    if (platform === "linux") {
      environment = (await fs.readFile(`/proc/${pid}/environ`)).toString("utf8").replaceAll("\0", " ");
    } else {
      environment = await readPs(["eww", "-p", String(pid), "-o", "command="], 4 * 1024 * 1024);
    }
  } catch {
    return null;
  }
  return /(?:^|\s)CODEX_APP_(?:BASE_URL|API_KEY)=\S+/.test(environment);
}

function executableFromCommand(command) {
  const value = String(command ?? "");
  if (value.startsWith('"')) return value.slice(1, value.indexOf('"', 1));
  return value.split(/\s/, 1)[0] || null;
}

export async function readProcessIdentity(pid, platform = process.platform) {
  const row = await readProcessRow(pid);
  if (!row) return null;
  let executable = null;
  try {
    if (platform === "linux") executable = await fs.realpath(`/proc/${pid}/exe`);
    else if (platform === "darwin") {
      const { stdout } = await execFileAsync("/bin/ps", [
        "-p", String(pid), "-o", "comm=",
      ], { timeout: 5000, maxBuffer: 64 * 1024 });
      executable = stdout.trim();
    }
  } catch {}
  executable ||= executableFromCommand(row.command);
  if (!path.isAbsolute(executable ?? "")) return null;
  return {
    command: row.command,
    executable: await fs.realpath(executable).catch(() => executable),
    pid: row.pid,
    startedAt: row.startedAt,
  };
}

export function decideDesktopAction(processInfo, options) {
  const port = remoteDebuggingPort(processInfo.command);
  if (options.deferredKeys?.has(processIdentityKey(processInfo))) return "deferred-current";
  if (options.targetPort && port === options.targetPort) return "target-port-ready";
  if (port) return "other-debug-port";
  if (options.hasTargetPortProcess) return "secondary-uninstrumented";
  if (options.hasRelayOverride === null) return "environment-unreadable";
  if (options.hasRelayOverride) return "relay-needs-codexctl-launch";
  return "restart-official";
}

export async function terminateDesktopProcess(processInfo, desktop, timeoutMs = 10_000) {
  if (!await desktopProcessMatches(processInfo, desktop)) return false;
  const descendants = descendantProcessRows(await listProcessRows(), processInfo.pid);
  if (desktop.platform === "darwin" && desktop.bundle) {
    try {
      await requestMacDesktopQuit(processInfo.pid);
    } catch {
      process.kill(processInfo.pid, "SIGTERM");
    }
  } else {
    process.kill(processInfo.pid, "SIGTERM");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await desktopProcessMatches(processInfo, desktop)) {
      await terminateProcessSnapshots(descendants);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function liveSnapshots(snapshots) {
  if (!snapshots.length) return [];
  const live = new Map((await listProcessRows()).map((row) => [row.pid, row]));
  return snapshots.filter((snapshot) => {
    const row = live.get(snapshot.pid);
    return row?.startedAt === snapshot.startedAt && row.command === snapshot.command;
  });
}

async function waitForSnapshotsToExit(snapshots, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let remaining = await liveSnapshots(snapshots);
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    remaining = await liveSnapshots(remaining);
  }
  return remaining;
}

export async function terminateProcessSnapshots(snapshots, timeoutMs = 2000) {
  let remaining = await liveSnapshots(snapshots);
  for (const processInfo of remaining) {
    try { process.kill(processInfo.pid, "SIGTERM"); } catch {}
  }
  remaining = await waitForSnapshotsToExit(remaining, timeoutMs);
  for (const processInfo of remaining) {
    try { process.kill(processInfo.pid, "SIGKILL"); } catch {}
  }
  return waitForSnapshotsToExit(remaining, timeoutMs);
}

export async function terminateDetachedDesktopHelpers(desktop, timeoutMs = 1000) {
  const snapshots = await listDetachedDesktopHelpers(desktop);
  if (!snapshots.length) return [];
  // Re-snapshot once at the signal boundary. This verifies PID, start token,
  // command and the absence of a main App without spawning two `ps` commands
  // per helper (which was especially expensive after a crash loop).
  const current = new Map((await listDetachedDesktopHelpers(desktop)).map((row) => [row.pid, row]));
  const verified = snapshots.filter((snapshot) => {
    const row = current.get(snapshot.pid);
    return row?.startedAt === snapshot.startedAt && row.command === snapshot.command;
  });
  for (const helper of verified) {
    try { process.kill(helper.pid, "SIGTERM"); } catch {}
  }
  const deadline = Date.now() + timeoutMs;
  const remaining = new Map(verified.map((helper) => [helper.pid, helper]));
  while (remaining.size && Date.now() < deadline) {
    const live = new Map((await listProcessRows()).map((row) => [row.pid, row]));
    for (const helper of remaining.values()) {
      if (live.get(helper.pid)?.startedAt !== helper.startedAt) remaining.delete(helper.pid);
    }
    if (remaining.size) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return verified.filter((helper) => !remaining.has(helper.pid)).map((helper) => helper.pid);
}

export function profileCrashHandlerMatches(command, profile, desktop) {
  const database = profile + path.sep + "Crashpad";
  if (!String(command).includes("/browser_crashpad_handler ")
    || !String(command).includes(" --database=" + database)) return false;
  const bundleMarker = path.sep + "Contents" + path.sep + "MacOS" + path.sep;
  const markerIndex = desktop.executable.indexOf(bundleMarker);
  if (markerIndex < 0) return true;
  const bundleRoot = desktop.executable.slice(0, markerIndex);
  return String(command).startsWith(bundleRoot + path.sep + "Contents" + path.sep);
}

export async function terminateProfileCrashHandlers(profile, desktop, timeoutMs = 3000) {
  const resolved = path.resolve(profile);
  const canonical = await fs.realpath(resolved).catch(() => resolved);
  const profiles = new Set([resolved, canonical]);
  const matches = (await listProcessRows()).filter((row) =>
    [...profiles].some((entry) => profileCrashHandlerMatches(row.command, entry, desktop)),
  );
  if (!matches.length) return [];

  const current = new Map((await listProcessRows()).map((row) => [row.pid, row]));
  const verified = matches.filter((match) => {
    const row = current.get(match.pid);
    return row?.startedAt === match.startedAt && row.command === match.command;
  });
  for (const match of verified) {
    try { process.kill(match.pid, "SIGTERM"); } catch {}
  }
  const remaining = new Map(verified.map((match) => [match.pid, match]));
  const deadline = Date.now() + timeoutMs;
  while (remaining.size && Date.now() < deadline) {
    const live = new Map((await listProcessRows()).map((row) => [row.pid, row]));
    for (const match of remaining.values()) {
      if (live.get(match.pid)?.startedAt !== match.startedAt) remaining.delete(match.pid);
    }
    if (remaining.size) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return verified.filter((match) => !remaining.has(match.pid)).map((match) => match.pid);
}
