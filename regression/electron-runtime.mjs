import fs from "node:fs/promises";
import { constants, watch } from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sanitizedBaseEnvironment } from "../src/relay.mjs";
import { readProcessRow, terminateProcessSnapshots } from "../src/desktop-processes.mjs";
import {
  assertSafeProfile,
  registerOwnedProcess,
  releaseExitedProcess,
  verifyOwnedProcess,
} from "./ownership.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(PROJECT_ROOT, "test-support", "electron-regression-app");
let cachedElectron = null;

export function testElectronCiOptions(env = process.env) {
  const enabled = env.CODEXCTL_TEST_ELECTRON_CI === "1";
  return {
    arguments: enabled ? ["--no-sandbox", "--disable-gpu"] : [],
    showWindow: enabled,
  };
}

export async function discoverTestElectron(env = process.env) {
  if (cachedElectron) return cachedElectron;
  if (path.isAbsolute(env.CODEXCTL_TEST_ELECTRON || "")) {
    await fs.access(env.CODEXCTL_TEST_ELECTRON, constants.X_OK);
    cachedElectron = env.CODEXCTL_TEST_ELECTRON;
    return cachedElectron;
  }
  const resolver = `const fs=require("node:fs"),p=require("node:path");
const e=process.env.PATH.split(p.delimiter).map(d=>p.join(d,"electron")).find(fs.existsSync);
if(!e)process.exit(2);process.stdout.write(require(p.resolve(p.dirname(e),"../electron")));`;
  const { stdout } = await execFileAsync("npm", [
    "exec", "--yes", "--package=electron@37.7.0", "--", "node", "-e", resolver,
  ], { cwd: PROJECT_ROOT, timeout: 120_000, maxBuffer: 128 * 1024, env });
  const executable = stdout.trim();
  if (!path.isAbsolute(executable)) throw new Error("Electron resolver returned no executable");
  await fs.access(executable, constants.X_OK);
  cachedElectron = executable;
  return executable;
}

export function waitForJson(filename, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      watcher.close();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const read = async () => {
      try { finish(null, JSON.parse(await fs.readFile(filename, "utf8"))); }
      catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) finish(error);
      }
    };
    const watcher = watch(path.dirname(filename), read);
    watcher.once("error", finish);
    const timer = setTimeout(() => finish(new Error("Electron App fixture readiness timed out")), timeoutMs);
    void read();
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error("Electron App fixture exit timed out")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? (signal ? 128 : 1));
    });
  });
}

async function terminateVerified(envelope, pid) {
  const current = await readProcessRow(pid);
  if (!current) return false;
  verifyOwnedProcess(envelope, current, pid);
  process.kill(pid, "SIGTERM");
  return true;
}

export async function launchElectronFixture({
  deadlineMs = 60_000,
  debug = true,
  envelope,
  electron = null,
  height = 700,
  width = 1000,
} = {}) {
  if (!envelope?.root || !Number.isInteger(envelope.port)) {
    throw new TypeError("Electron fixture requires a run ownership envelope");
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 10_000 || deadlineMs > 300_000) {
    throw new RangeError("Electron fixture deadline is out of bounds");
  }
  assertSafeProfile(envelope.profile, { envelope });
  await envelope.releasePort();
  const token = `${Date.now()}-${process.pid}`;
  const configFile = path.join(envelope.runtime, `app-${token}.json`);
  const readyFile = path.join(envelope.runtime, `ready-${token}.json`);
  const stopFile = path.join(envelope.runtime, `stop-${token}`);
  const snapshotFile = path.join(envelope.runtime, `snapshot-${token}`);
  const snapshotResultFile = path.join(envelope.runtime, `snapshot-result-${token}.json`);
  const ci = testElectronCiOptions();
  await fs.writeFile(configFile, `${JSON.stringify({
    deadlineMs, height, profile: envelope.profile, readyFile, snapshotFile,
    showWindow: ci.showWindow, snapshotResultFile, stopFile, width,
  })}\n`, { mode: 0o600 });
  const executable = electron ?? await discoverTestElectron();
  const child = spawn(executable, [
    ...ci.arguments,
    ...(debug ? [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${envelope.port}`,
    ] : []),
    FIXTURE,
    `--fixture-config=${configFile}`,
  ], {
    env: { ...sanitizedBaseEnvironment(process.env), ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  let ready;
  try {
    ready = await waitForJson(readyFile, deadlineMs);
    if (ready?.error) throw new Error(`fixture app-server failed: ${ready.error}`);
    if (ready?.pid !== child.pid || ready?.url !== "app://-/index.html") {
      throw new Error("Electron fixture readiness identity did not match owned App");
    }
    for (const pid of [ready.pid, ready.appServerPid]) {
      const row = await readProcessRow(pid);
      if (!row) throw new Error(`Electron fixture process ${pid} disappeared before ownership capture`);
      registerOwnedProcess(envelope, row);
    }
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await waitForExit(child, 2000).catch(() => child.kill("SIGKILL"));
    throw new Error(`${error.message}${stderr ? `; Electron: ${stderr}` : ""}`);
  }

  let closed = false;
  return {
    child,
    executable,
    port: envelope.port,
    profile: envelope.profile,
    ready,
    async nativeSnapshot() {
      await fs.rm(snapshotResultFile, { force: true });
      await fs.writeFile(snapshotFile, "snapshot\n", { mode: 0o600 });
      return waitForJson(snapshotResultFile, 5000);
    },
    async close() {
      if (closed) return { orphans: [], status: "pass" };
      closed = true;
      await fs.writeFile(stopFile, "stop\n", { mode: 0o600 });
      try { await waitForExit(child, 5000); }
      catch {
        await terminateVerified(envelope, ready.pid);
        await waitForExit(child, 2000).catch(() => child.kill("SIGKILL"));
      }
      const serverRecord = envelope.processes.get(ready.appServerPid);
      if (serverRecord) await terminateProcessSnapshots([serverRecord], 2000);
      const orphans = [];
      for (const [pid] of envelope.processes) {
        if (await readProcessRow(pid)) orphans.push({ kind: "fixture", pid });
      }
      if (orphans.length === 0) {
        for (const pid of [ready.pid, ready.appServerPid]) {
          await releaseExitedProcess(envelope, pid);
        }
      }
      await Promise.all([
        configFile, readyFile, snapshotFile, snapshotResultFile, stopFile,
      ].map((filename) => (
        fs.rm(filename, { force: true })
      )));
      return { orphans, status: orphans.length ? "fail" : "pass" };
    },
  };
}
