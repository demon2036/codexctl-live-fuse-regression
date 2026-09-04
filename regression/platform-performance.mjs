import { evaluateBudget } from "./budgets.mjs";
import {
  MAX_EXTERNAL_CPU_POINTS,
  readOwnedCpuSnapshot,
  readSystemCpuSnapshot,
  sampleCpuSegment,
} from "./cpu-sampler.mjs";
import { runRendererSegment } from "./renderer-segment-workload.mjs";

const CPU_PHASES = Object.freeze(["idle", "input", "scroll", "stream"]);
const CPU_KINDS = Object.freeze(["main", "renderer"]);

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function statusMap(budgets) {
  return Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, value.status]));
}

function interactionBudget(key, officialRuns, injected) {
  return evaluateBudget(key, {
    baselineValid: true,
    injectedMaxMs: injected.benchmark[key].maxMs,
    injectedP95Ms: injected.benchmark[key].p95Ms,
    officialMaxMs: Math.max(...officialRuns.map((run) => run.benchmark[key].maxMs)),
    officialP95Ms: median(officialRuns.map((run) => run.benchmark[key].p95Ms)),
  });
}

function cpuBudget(phase, kind, officialRuns, injected) {
  const summaries = officialRuns.map((run) => run.cpu[phase]);
  return evaluateBudget("cpu", {
    baselineValid: true,
    injectedMedian: mean(injected.cpu[phase].raw.map((sample) => sample[kind])),
    injectedP95: injected.cpu[phase].summary[kind].p95,
    officialMedian: median(summaries.map(
      (segment) => mean(segment.raw.map((sample) => sample[kind])),
    )),
    officialP95: Math.max(...summaries.map((segment) => segment.summary[kind].p95)),
  });
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function addedLongTaskFailures(officialRuns, injected) {
  const failures = [];
  const benchmarkBaseline = Math.max(...officialRuns.map(
    (run) => run.benchmark.longTasks.samples,
  ));
  if (injected.benchmark.longTasks.samples > benchmarkBaseline) {
    failures.push("run-1-long-task");
  }
  for (const phase of CPU_PHASES.filter((candidate) => candidate !== "idle")) {
    const baseline = Math.max(...officialRuns.map(
      (run) => run.cpu[phase].actionResult.longTaskCount,
    ));
    if (injected.cpu[phase].actionResult.longTaskCount > baseline) {
      failures.push(`run-1-${phase}-long-task`);
    }
  }
  return failures;
}

function complete(run) {
  return run?.status === "pass" && Number.isFinite(run.launchMs)
    && Number.isFinite(run.visibleMs) && run.benchmark?.restored === true
    && nonnegativeInteger(run.benchmark?.longTasks?.samples)
    && CPU_PHASES.every((phase) => run.cpu?.[phase]?.status === "pass"
      && (phase === "idle"
        || nonnegativeInteger(run.cpu[phase].actionResult?.longTaskCount)));
}

export async function samplePlatformCpuSegment(measure, maxAttempts = 2) {
  if (typeof measure !== "function" || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1 || maxAttempts > 2) {
    throw new TypeError("Platform CPU measure and bounded attempts are required");
  }
  const attempts = [];
  while (attempts.length < maxAttempts) {
    const result = await measure({ attempt: attempts.length });
    if (!new Set(["invalid", "pass"]).has(result?.status)) {
      throw new Error("Platform CPU measure returned an invalid status");
    }
    attempts.push(result);
    if (result.status === "pass") break;
  }
  const result = attempts.at(-1);
  return {
    ...result,
    attemptCount: attempts.length,
    attemptReasonCodes: attempts.filter(({ status }) => status === "invalid")
      .map(({ reasonCode }) => reasonCode ?? "invalid-sample"),
    attempts,
  };
}

export function evaluatePlatformPerformance({ injected, official, recovery } = {}) {
  const runs = [official, injected, recovery];
  const unverified = runs.flatMap((run, index) => run?.status === "unverified"
    ? (run.reasonCodes ?? []).map((code) => `run-${index}-${code}`) : []);
  if (unverified.length) {
    return { budgets: {}, failures: [], reasonCodes: unverified, status: "unverified" };
  }
  const invalidCpu = runs.flatMap((run, index) => CPU_PHASES.flatMap((phase) => (
    run?.cpu?.[phase]?.status === "invalid"
      ? [`run-${index}-${phase}-${run.cpu[phase].reasonCode ?? "invalid-sample"}`] : []
  )));
  if (invalidCpu.length) {
    return { budgets: {}, failures: [], reasonCodes: invalidCpu, status: "unverified" };
  }
  if (!runs.every(complete)) {
    return { budgets: {}, failures: ["performance-evidence-incomplete"],
      reasonCodes: ["performance-evidence-incomplete"], status: "fail" };
  }
  const officialRuns = [official, recovery];
  const budgets = {
    startup: evaluateBudget("startup", {
      baselineValid: true,
      injectedMedianMs: injected.launchMs,
      officialMedianMs: median(officialRuns.map(({ launchMs }) => launchMs)),
      visibleP95Ms: injected.visibleMs,
    }),
    input: interactionBudget("input", officialRuns, injected),
    scroll: interactionBudget("scroll", officialRuns, injected),
    ...Object.fromEntries(CPU_PHASES.flatMap((phase) => CPU_KINDS.map((kind) => [
      `cpu-${phase}-${kind}`, cpuBudget(phase, kind, officialRuns, injected),
    ]))),
  };
  const failures = Object.entries(budgets).filter(([, value]) => value.status !== "pass")
    .map(([key]) => `budget-${key}`);
  failures.push(...addedLongTaskFailures(officialRuns, injected));
  const reasonCodes = [...new Set(failures)].sort();
  return { budgets: statusMap(budgets), failures: reasonCodes,
    reasonCodes, status: reasonCodes.length ? "fail" : "pass" };
}

export async function collectPlatformCpu({ idleDurationMs = 30_000, pid, port } = {}) {
  const snapshot = () => readOwnedCpuSnapshot(pid);
  const common = { intervalMs: 500, maximumExternalCpu: MAX_EXTERNAL_CPU_POINTS,
    snapshot, systemSnapshot: readSystemCpuSnapshot };
  const idle = await samplePlatformCpuSegment(() => sampleCpuSegment({
    durationMs: idleDurationMs, ...common,
  }));
  const result = { idle };
  for (const phase of ["input", "scroll", "stream"]) {
    result[phase] = await samplePlatformCpuSegment(() => sampleCpuSegment({
      action: () => runRendererSegment(port, phase),
      durationMs: 15_000,
      ...common,
    }));
  }
  return result;
}

export { CPU_PHASES as PLATFORM_CPU_PHASES };
