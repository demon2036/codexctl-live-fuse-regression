import { evaluateBudget } from "./budgets.mjs";
import { MAC_CPU_PHASES } from "./macos-native-performance.mjs";

function append(target, prefix, values) {
  for (const value of values ?? []) target.push(`${prefix}-${value}`);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSummary(values) {
  if (!Array.isArray(values) || values.length < 20
    || values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return { maxMs: sorted.at(-1), p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

function nativeSamples(run, kind) {
  return sampleSummary(kind === "input"
    ? run?.native?.composer?.latenciesMs : run?.native?.sessions?.latenciesMs);
}

function cpuComplete(run) {
  return MAC_CPU_PHASES.every((phase) => run?.cpu?.[phase]?.status === "pass"
    && Array.isArray(run.cpu[phase].raw) && run.cpu[phase].raw.length >= 2
    && Number.isFinite(run.cpu[phase].summary?.total?.p95));
}

function cpuBudget(phase, official, injected, recovery) {
  const baseline = [official.cpu[phase], recovery.cpu[phase]];
  return evaluateBudget("cpu", {
    baselineValid: true,
    injectedMedian: mean(injected.cpu[phase].raw.map(({ total }) => total)),
    injectedP95: injected.cpu[phase].summary.total.p95,
    officialMedian: median(baseline.map(
      (segment) => mean(segment.raw.map(({ total }) => total)),
    )),
    officialP95: Math.max(...baseline.map((segment) => segment.summary.total.p95)),
  });
}

export function evaluateMacPlatformPerformance({ injected, official, recovery } = {}) {
  const runs = [official, injected, recovery];
  const unavailable = runs.some((run) => run?.status === "unverified");
  if (unavailable) {
    return { budgets: {}, failures: [], reasonCodes: ["interactive-evidence-unavailable"],
      status: "unverified" };
  }
  const unavailableCpu = runs.flatMap((run, index) => MAC_CPU_PHASES.flatMap((phase) => (
    new Set(["invalid", "unverified"]).has(run?.cpu?.[phase]?.status)
      ? [`run-${index}-${phase}-${run.cpu[phase].reasonCode ?? "invalid-sample"}`] : []
  )));
  if (unavailableCpu.length) {
    return { budgets: {}, failures: [], reasonCodes: unavailableCpu, status: "unverified" };
  }
  const input = runs.map((run) => nativeSamples(run, "input"));
  const scroll = runs.map((run) => nativeSamples(run, "scroll"));
  if (runs.some((run) => !Number.isFinite(run?.launchMs))
    || !Number.isFinite(injected?.visibleMs) || input.some((value) => !value)
    || scroll.some((value) => !value) || !runs.every(cpuComplete)) {
    return { budgets: {}, failures: ["performance-evidence-incomplete"],
      reasonCodes: ["performance-evidence-incomplete"], status: "fail" };
  }
  const interaction = (key, samples) => evaluateBudget(key, {
    baselineValid: true,
    injectedMaxMs: samples[1].maxMs,
    injectedP95Ms: samples[1].p95Ms,
    officialMaxMs: Math.max(samples[0].maxMs, samples[2].maxMs),
    officialP95Ms: median([samples[0].p95Ms, samples[2].p95Ms]),
  });
  const evaluated = {
    startup: evaluateBudget("startup", {
      baselineValid: true,
      injectedMedianMs: injected.launchMs,
      officialMedianMs: median([official.launchMs, recovery.launchMs]),
      visibleP95Ms: injected.visibleMs,
    }),
    input: interaction("input", input),
    scroll: interaction("scroll", scroll),
    ...Object.fromEntries(MAC_CPU_PHASES.map((phase) => [
      `cpu-${phase}`, cpuBudget(phase, official, injected, recovery),
    ])),
  };
  const failures = Object.entries(evaluated).filter(([, value]) => value.status !== "pass")
    .map(([key]) => `budget-${key}`);
  return {
    budgets: Object.fromEntries(Object.entries(evaluated).map(([key, value]) => [key, value.status])),
    failures,
    reasonCodes: failures,
    status: failures.length ? "fail" : "pass",
  };
}

export function evaluateMacPlatformSequence({ injected, official, recovery } = {}) {
  const failures = [];
  const unverified = [];
  for (const [name, result] of Object.entries({ official, injected, recovery })) {
    if (!result) {
      failures.push(`${name}-result-missing`);
      continue;
    }
    if (result.status === "fail") append(failures, name, result.reasonCodes);
    if (result.status === "unverified") append(unverified, name, result.reasonCodes);
    if (result.cleanup?.status !== "pass") failures.push(`${name}-cleanup`);
    if (result.remote !== "connected") failures.push(`${name}-remote`);
    if (result.appServerCount !== 1) failures.push(`${name}-app-server-count`);
    if (result.remoteDebugging !== false) failures.push(`${name}-remote-debugging`);
    if (!Array.isArray(result.functionalArguments) || result.functionalArguments.length !== 0) {
      failures.push(`${name}-functional-arguments`);
    }
  }
  if (official?.appVersion !== injected?.appVersion || official?.appVersion !== recovery?.appVersion) {
    failures.push("app-version-mismatch");
  }
  if (official?.cliVersion !== injected?.cliVersion || official?.cliVersion !== recovery?.cliVersion) {
    failures.push("cli-version-mismatch");
  }
  const pids = [official, injected, recovery].map((result) => result?.processId).filter(Number.isFinite);
  if (pids.length !== 3 || new Set(pids).size !== 3) failures.push("recovery-process-boundary");
  const performance = evaluateMacPlatformPerformance({ injected, official, recovery });
  if (performance.status === "fail") append(failures, "performance", performance.reasonCodes);
  if (performance.status === "unverified") append(unverified, "performance", performance.reasonCodes);
  return {
    failures: [...new Set(failures)].sort(),
    performance,
    reasonCodes: [...new Set([...failures, ...unverified])].sort(),
    status: failures.length ? "fail" : unverified.length ? "unverified" : "pass",
  };
}
