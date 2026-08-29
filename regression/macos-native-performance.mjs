import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MAX_EXTERNAL_CPU_POINTS,
  readOwnedCpuSnapshot,
  readSystemCpuSnapshot,
  sampleCpuSegment,
} from "./cpu-sampler.mjs";

const execFileAsync = promisify(execFile);
export const MAC_CPU_PHASES = Object.freeze(["idle", "input", "scroll", "stream"]);

export function evaluateMacNativeWorkload(value, { phase, pid } = {}) {
  const valid = value?.schema === "codexctl-macos-native-workload/1"
    && value.pid === pid && value.phase === phase && value.verified === true
    && value.restored === true && Number.isSafeInteger(value.operations) && value.operations > 0
    && Number.isFinite(value.durationMs) && value.durationMs >= 0;
  return valid
    ? { ...value, reasonCodes: [], status: "pass" }
    : { phase, pid, reasonCodes: ["native-workload-unavailable"], status: "unverified" };
}

export async function runMacNativeWorkload({ durationMs, executable, phase, pid } = {}) {
  const { stdout } = await execFileAsync(executable, [
    "--pid", String(pid), "--workload", phase, "--duration-ms", String(durationMs),
  ], {
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    maxBuffer: 256 * 1024,
    timeout: durationMs + 20_000,
  });
  let value;
  try { value = JSON.parse(stdout); } catch { value = null; }
  return evaluateMacNativeWorkload(value, { phase, pid });
}

function normalizeSegment(segment) {
  if (segment.actionResult?.status === "unverified") {
    return { ...segment, reasonCode: segment.actionResult.reasonCodes[0], status: "unverified" };
  }
  return segment;
}

export async function collectMacNativeCpu({
  executable,
  idleDurationMs = 30_000,
  pid,
  workloadDurationMs = 12_000,
} = {}) {
  const common = {
    intervalMs: 500,
    maximumExternalCpu: MAX_EXTERNAL_CPU_POINTS,
    snapshot: () => readOwnedCpuSnapshot(pid),
    systemSnapshot: readSystemCpuSnapshot,
  };
  const result = {
    idle: await sampleCpuSegment({ durationMs: idleDurationMs, ...common }),
  };
  for (const phase of MAC_CPU_PHASES.slice(1)) {
    const segment = await sampleCpuSegment({
      action: () => runMacNativeWorkload({ durationMs: workloadDurationMs,
        executable, phase, pid }),
      durationMs: workloadDurationMs + 5_000,
      ...common,
    });
    result[phase] = normalizeSegment(segment);
  }
  return result;
}
