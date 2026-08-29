import fs from "node:fs/promises";
import { ConfigError } from "./errors.mjs";
import { processCommand } from "./desktop-processes.mjs";

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function readSupervisorState(paths) {
  try { return JSON.parse(await fs.readFile(paths.supervisorPidFile, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function pidLooksLikeSupervisor(pid, paths) {
  if (!processAlive(pid)) return false;
  const command = await processCommand(pid);
  return command.includes("supervisor-worker.mjs") && command.includes(paths.home);
}

export async function stopSupervisor(paths) {
  const state = await readSupervisorState(paths);
  if (!state) return { stopped: false, reason: "not-running" };
  if (!await pidLooksLikeSupervisor(state.pid, paths)) {
    await fs.rm(paths.supervisorPidFile, { force: true });
    return { stopped: false, reason: "stale-state" };
  }
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline && processAlive(state.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processAlive(state.pid)) throw new ConfigError(`旧监督器 PID ${state.pid} 未能退出。`);
  await fs.rm(paths.supervisorPidFile, { force: true });
  return { stopped: true, pid: state.pid };
}
