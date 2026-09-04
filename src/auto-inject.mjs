import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigError } from "./errors.mjs";
import { processAlive } from "./supervisor.mjs";
import { processCommand } from "./desktop-processes.mjs";

const execFileAsync = promisify(execFile);
export const MAC_AUTO_INJECT_LABEL = "com.user.codexctl-auto-inject";

function entryFile(paths, platform) {
  return platform === "darwin" ? paths.macLaunchAgentFile : paths.linuxAutostartFile;
}

export function startupEntryOwnedByController(source, paths) {
  return typeof source === "string"
    && source.includes(paths.home)
    && (source.includes(paths.autoInjectLauncher) || source.includes("codexctl-auto-inject"));
}

async function startupEntry(paths, platform) {
  const file = entryFile(paths, platform);
  try {
    const source = await fs.readFile(file, "utf8");
    return { file, exists: true, owned: startupEntryOwnedByController(source, paths) };
  } catch (error) {
    if (error.code === "ENOENT") return { file, exists: false, owned: false };
    throw error;
  }
}

export async function readAutoInjectState(paths) {
  try { return JSON.parse(await fs.readFile(paths.autoInjectStateFile, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function pidLooksLikeAutoInject(pid, paths) {
  if (!processAlive(pid)) return false;
  const command = await processCommand(pid);
  return command.includes("auto-inject-worker.mjs") && command.includes(paths.home);
}

async function stopLegacyWorker(paths) {
  const state = await readAutoInjectState(paths);
  if (!state || !await pidLooksLikeAutoInject(state.pid, paths)) return false;
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline && await pidLooksLikeAutoInject(state.pid, paths)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (await pidLooksLikeAutoInject(state.pid, paths)) {
    throw new ConfigError(`旧自动注入进程 PID ${state.pid} 未能退出。`);
  }
  return true;
}

async function macService(paths) {
  const service = `gui/${process.getuid()}/${MAC_AUTO_INJECT_LABEL}`;
  try {
    const { stdout } = await execFileAsync("/bin/launchctl", ["print", service], {
      timeout: 1500,
      maxBuffer: 256 * 1024,
    });
    return { service, loaded: true, owned: stdout.includes(paths.home) };
  } catch { return { service, loaded: false, owned: false }; }
}

export async function uninstallAutoInject(paths, platform = process.platform) {
  if (!["darwin", "linux"].includes(platform)) {
    throw new ConfigError(`旧自动注入清理只支持 macOS/Linux；检测到 ${platform}。`);
  }
  const entry = await startupEntry(paths, platform);
  let skippedForeign = entry.exists && !entry.owned;
  if (platform === "darwin") {
    const service = await macService(paths);
    if (service.loaded && service.owned) {
      await execFileAsync("/bin/launchctl", ["bootout", service.service], {
        timeout: 5000,
        maxBuffer: 256 * 1024,
      }).catch(() => {});
    } else if (service.loaded) skippedForeign = true;
  }
  await stopLegacyWorker(paths);
  if (entry.owned) await fs.rm(entry.file, { force: true });
  await Promise.all([
    fs.rm(paths.autoInjectStateFile, { force: true }),
    fs.rm(paths.autoInjectLockFile, { force: true }),
  ]);
  return { platform, removed: entry.owned, skippedForeign };
}

export async function autoInjectStatus(paths, platform = process.platform) {
  if (!["darwin", "linux"].includes(platform)) {
    throw new ConfigError(`旧自动注入检查只支持 macOS/Linux；检测到 ${platform}。`);
  }
  const entry = await startupEntry(paths, platform);
  const state = await readAutoInjectState(paths);
  const running = Boolean(state && await pidLooksLikeAutoInject(state.pid, paths));
  return { platform, installed: entry.owned, conflict: entry.exists && !entry.owned,
    file: entry.file, running, state: running ? state : null };
}
