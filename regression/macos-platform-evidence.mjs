import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createMacNativeTransport,
  runMacNativeProbe,
} from "./macos-native-probe.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function redactMacAppArguments(values = []) {
  return values.map((value) => value.startsWith("--user-data-dir=")
    ? "--user-data-dir=<isolated-profile>" : value);
}

export async function compileMacNativeProbe(envelope) {
  const executable = path.join(envelope.runtime, "macos-app-probe");
  try {
    await execFileAsync("/usr/bin/xcrun", [
      "swiftc", "-parse-as-library",
      path.join(projectRoot, "native", "macos-app-probe.swift"),
      path.join(projectRoot, "native", "macos-window-probe.swift"),
      path.join(projectRoot, "native", "macos-app-workloads.swift"),
      "-o", executable,
    ], { timeout: 60_000, maxBuffer: 256 * 1024 });
  } catch {
    return null;
  }
  return executable;
}

export async function collectMacNativeEvidence({ envelope, executable, pid, readProcess }) {
  const probe = executable ?? await compileMacNativeProbe(envelope);
  if (!probe) return { cleanup: { stopped: true },
    reasonCodes: ["native-probe-unavailable"], status: "unverified" };
  try {
    return await runMacNativeProbe({
      envelope,
      pid,
      protectedPids: new Set(),
      readProcess,
      transport: createMacNativeTransport({ executable: probe, timeoutMs: 20_000 }),
    });
  } catch {
    return {
      cleanup: { stopped: true },
      reasonCodes: ["native-probe-failed"],
      status: "fail",
    };
  }
}

export function evaluateMacPlatformEvidence({ injection, mode, native }) {
  const failures = [];
  const unverified = [];
  if (native.status === "unverified") unverified.push(...native.reasonCodes);
  else if (native.status === "fail") {
    if (native.composer?.found === false) unverified.push("isolated-app-not-interactive");
    else failures.push(...native.reasonCodes.map((code) => `native-${code}`));
  }
  if (mode === "injected" && injection?.controlContextAvailable !== true) {
    if (native.composer?.found === true) failures.push("injected-controls-missing");
    else unverified.push("isolated-app-not-interactive");
  }
  return {
    failures: [...new Set(failures)].sort(),
    reasonCodes: [...new Set([...failures, ...unverified])].sort(),
    status: failures.length ? "fail" : unverified.length ? "unverified" : "pass",
  };
}
