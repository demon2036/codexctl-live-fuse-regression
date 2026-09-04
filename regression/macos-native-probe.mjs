import { spawn } from "node:child_process";
import { verifyOwnedProcess } from "./ownership.mjs";

const BOUND_FIELDS = ["height", "width", "x", "y"];

function validBounds(value) {
  return value !== null && typeof value === "object"
    && BOUND_FIELDS.every((field) => Number.isFinite(value[field]))
    && value.height > 0 && value.width > 0;
}

function validLatencySamples(values) {
  return Array.isArray(values) && values.length >= 20
    && values.every((value) => Number.isFinite(value) && value >= 0);
}

function collectFailures(raw, reasons) {
  const require = (condition, reason) => { if (!condition) reasons.add(reason); };
  require(raw.activation?.requested === true
    && (raw.activation?.hiddenBefore !== true || raw.activation?.unhideRequested === true)
    && raw.activation?.hiddenAfter === false && raw.activation?.succeeded === true,
    "app-activation");
  require(Number.isSafeInteger(raw.windowServer?.count) && raw.windowServer.count > 0
    && validBounds(raw.windowServer?.bounds), "window-server-window");
  require(Number.isSafeInteger(raw.windowServer?.onScreenCount)
    && raw.windowServer.onScreenCount > 0, "window-server-onscreen");
  require(validBounds(raw.window?.bounds), "window-bounds");
  require(raw.composer?.found === true, "composer-not-found");
  require(validBounds(raw.composer?.bounds), "composer-bounds");
  require(raw.composer?.inputVerified === true, "composer-input");
  require(raw.composer?.inputRestored === true, "composer-input-restore");
  require(validLatencySamples(raw.composer?.latenciesMs), "composer-input-samples");
  require(raw.sessions?.found === true, "sessions-not-found");
  require(validBounds(raw.sessions?.bounds), "sessions-bounds");
  require(raw.sessions?.scrollVerified === true, "sessions-scroll");
  require(raw.sessions?.scrollRestored === true, "sessions-scroll-restore");
  require(validLatencySamples(raw.sessions?.latenciesMs), "sessions-scroll-samples");
  require(raw.screenshot?.captured === true, "screenshot-capture");
}

export function evaluateMacNativeProbe(raw, expectedPid) {
  if (raw?.schema !== "codexctl-macos-native-probe/1") {
    throw new Error("invalid macOS native probe schema");
  }
  if (raw.pid !== expectedPid) throw new Error(`native probe PID mismatch: ${raw.pid}`);
  const reasons = new Set();
  if (raw.permissions?.accessibility !== true) reasons.add("permission-accessibility");
  if (raw.permissions?.screenRecording !== true) reasons.add("permission-screen-recording");
  if (reasons.size > 0) {
    return { ...raw, reasonCodes: [...reasons], status: "unverified" };
  }
  collectFailures(raw, reasons);
  return {
    ...raw,
    reasonCodes: [...reasons].sort(),
    status: reasons.size === 0 ? "pass" : "fail",
  };
}

async function assertOwnedTarget({ envelope, pid, protectedPids, readProcess }) {
  if (!Number.isSafeInteger(pid) || pid < 2 || !envelope?.processes?.has(pid)) {
    throw new Error(`unknown process PID ${String(pid)}`);
  }
  if (protectedPids?.has(pid)) throw new Error(`protected primary PID ${pid}`);
  const current = await readProcess(pid);
  if (!current) throw new Error(`unknown process PID ${pid}`);
  verifyOwnedProcess(envelope, current, pid);
}

export async function runMacNativeProbe({
  envelope, pid, protectedPids = new Set(), readProcess, transport,
} = {}) {
  if (typeof readProcess !== "function") throw new TypeError("readProcess must be a function");
  if (typeof transport?.start !== "function") throw new TypeError("native transport is required");
  await assertOwnedTarget({ envelope, pid, protectedPids, readProcess });
  const session = await transport.start({ pid });
  if (!session || typeof session.stop !== "function") throw new Error("invalid native session");
  let primaryError;
  try {
    const raw = await session.result;
    return { ...evaluateMacNativeProbe(raw, pid), cleanup: { stopped: true } };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { await session.stop(); }
    catch (stopError) {
      if (primaryError) primaryError.cleanupError = stopError;
      else throw stopError;
    }
  }
}

export function createMacNativeTransport({ executable, spawnImpl = spawn, timeoutMs = 5000 } = {}) {
  if (typeof executable !== "string" || !executable.startsWith("/")) {
    throw new Error("native probe executable must be an absolute path");
  }
  return {
    async start({ pid }) {
      const child = spawnImpl(executable, ["--pid", String(pid)], {
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      let timer;
      const result = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`native probe deadline ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(`native probe exited ${code ?? signal}: ${stderr.trim()}`));
            return;
          }
          try { resolve(JSON.parse(output)); }
          catch { reject(new Error("native probe returned invalid JSON")); }
        });
      });
      return {
        result,
        async stop() {
          clearTimeout(timer);
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        },
      };
    },
  };
}
