import { percentile } from "./ab-sampler.mjs";
import { evaluateBudget } from "./budgets.mjs";
import { createRunEnvelope } from "./ownership.mjs";
import { discoverTestElectron } from "./electron-runtime.mjs";
import { createElectronAppAdapter } from "./electron-app-adapter.mjs";
import { runAppProbe } from "./app-probe-contract.mjs";
import {
  MAX_EXTERNAL_CPU_POINTS,
  readOwnedCpuSnapshot,
  readSystemCpuSnapshot,
  sampleCpuSegment,
} from "./cpu-sampler.mjs";
import { runRendererSegment } from "./renderer-segment-workload.mjs";

const GROUP_ORDERS = Object.freeze([
  Object.freeze(["official", "injected", "injected", "official"]),
  Object.freeze(["injected", "official", "official", "injected"]),
]);
const ORDER = Object.freeze(GROUP_ORDERS.flat());
const PHASES = Object.freeze(["idle", "input", "scroll", "stream"]);
const KINDS = Object.freeze(["main", "renderer", "other", "total"]);
const WORK_FIELDS = Object.freeze([
  "layoutDurationMs", "scriptDurationMs", "styleDurationMs", "taskDurationMs",
]);
const BUDGET_KINDS = Object.freeze(["main", "renderer"]);

export function normalizeCpuPhases(value = PHASES) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
    || value.some((phase) => !PHASES.includes(phase))) {
    throw new Error("CPU phases require a non-empty unique supported list");
  }
  return Object.freeze(PHASES.filter((phase) => value.includes(phase)));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function kindSummary(runs, mode, phase, kind) {
  const rawValues = runs.filter((run) => run.mode === mode)
    .map((run) => run.cpu[phase].raw.map((sample) => sample[kind]));
  const values = rawValues.map((samples) => (
    samples.reduce((sum, value) => sum + value, 0) / samples.length
  ));
  const runP95Values = rawValues.map((samples) => percentile(samples, 0.95));
  return {
    max: Math.max(...rawValues.flat()),
    p50: median(values),
    p95: percentile(runP95Values, 0.95),
    rawValues,
    runP95Values,
    values,
  };
}

function workSummary(runs, mode, phase) {
  if (phase === "idle") return {};
  return Object.fromEntries(WORK_FIELDS.map((field) => {
    const values = runs.filter((run) => run.mode === mode)
      .map((run) => run.cpu[phase].actionResult?.[field]);
    return [field, {
      max: Math.max(...values), p50: median(values), p95: percentile(values, 0.95), values,
    }];
  }));
}

function phaseSummary(runs, mode, phase) {
  const kinds = Object.fromEntries(KINDS.map((kind) => [
    kind, kindSummary(runs, mode, phase, kind),
  ]));
  return { ...kinds.total, kinds, work: workSummary(runs, mode, phase) };
}

function groupKindMetrics(runs, phase, kind, mode) {
  const selected = runs.filter((run) => run.mode === mode);
  const means = selected.map((run) => {
    const values = run.cpu[phase].raw.map((sample) => sample[kind]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const p95s = selected.map((run) => percentile(
    run.cpu[phase].raw.map((sample) => sample[kind]), 0.95,
  ));
  return {
    median: median(means),
    p95: percentile(p95s, 0.95),
  };
}

function groupStability(runs, phase) {
  const kinds = Object.fromEntries(BUDGET_KINDS.map((kind) => {
    const statuses = GROUP_ORDERS.map((order, groupIndex) => {
      const group = runs.slice(groupIndex * order.length, (groupIndex + 1) * order.length);
      const official = groupKindMetrics(group, phase, kind, "official");
      const injected = groupKindMetrics(group, phase, kind, "injected");
      return evaluateBudget("cpu", {
        baselineValid: true,
        injectedMedian: injected.median,
        injectedP95: injected.p95,
        officialMedian: official.median,
        officialP95: official.p95,
      }).status;
    });
    return [kind, { statuses }];
  }));
  const flipped = Object.entries(kinds)
    .filter(([, value]) => new Set(value.statuses).size > 1).map(([kind]) => kind);
  return { flipped, kinds, status: flipped.length ? "mixed" : "stable" };
}

function phaseBudget(summary) {
  const kinds = Object.fromEntries(BUDGET_KINDS.map((kind) => [kind, evaluateBudget("cpu", {
    baselineValid: true,
    injectedMedian: summary.injected.kinds[kind].p50,
    injectedP95: summary.injected.kinds[kind].p95,
    officialMedian: summary.official.kinds[kind].p50,
    officialP95: summary.official.kinds[kind].p95,
  })]));
  const statuses = Object.values(kinds).map(({ status }) => status);
  const status = statuses.includes("invalid") ? "invalid"
    : statuses.includes("fail") ? "fail" : "pass";
  return { kinds, status };
}

export async function runBoundedCpuAttempts(measure, { maxAttempts = 2 } = {}) {
  if (typeof measure !== "function" || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1 || maxAttempts > 2) throw new Error("Invalid CPU attempt bounds");
  const attempts = [];
  while (attempts.length < maxAttempts) {
    const result = await measure({ attempt: attempts.length });
    if (!new Set(["pass", "fail", "invalid"]).has(result?.status)) {
      throw new Error("Invalid CPU attempt result");
    }
    attempts.push(result);
    if (result.status !== "invalid") break;
  }
  return { attempts, result: attempts.at(-1), statuses: attempts.map(({ status }) => status) };
}

export function evaluateAppCpuPerformance(runs, { phases: selectedPhases } = {}) {
  const phases = normalizeCpuPhases(selectedPhases);
  const failures = [];
  const invalidSamples = [];
  if (!Array.isArray(runs) || runs.length !== ORDER.length) {
    return { budgets: {}, failures: ["cpu-sequence"], status: "invalid" };
  }
  runs.forEach((run, index) => {
    if (run.mode !== ORDER[index]) failures.push(`cpu-order-${index}`);
    if (run.result?.status !== "pass" || run.result?.cleanup?.status !== "pass") {
      failures.push(`cpu-probe-${index}`);
    }
    if (run.result?.processTree?.controllerCount !== 0) failures.push(`cpu-controller-${index}`);
    for (const field of ["observerCount", "timerCount", "workerCount"]) {
      if (run.result?.metrics?.[field] !== 0) failures.push(`cpu-${field}-${index}`);
    }
    for (const phase of phases) {
      if (run.cpu?.[phase]?.status === "invalid") invalidSamples.push(`cpu-${phase}-${index}`);
      else if (run.cpu?.[phase]?.status !== "pass") failures.push(`cpu-${phase}-${index}`);
      if (phase !== "idle" && run.cpu?.[phase]?.status === "pass"
        && run.cpu[phase].actionResult?.longTaskCount !== 0) {
        failures.push(`cpu-long-task-${phase}-${index}`);
      }
    }
  });
  if (failures.length) return { budgets: {}, failures, status: "fail" };
  if (invalidSamples.length) return { budgets: {}, failures: invalidSamples, status: "invalid" };
  const summary = Object.fromEntries(phases.map((phase) => [phase, {
    injected: phaseSummary(runs, "injected", phase),
    official: phaseSummary(runs, "official", phase),
    stability: groupStability(runs, phase),
  }]));
  const budgets = Object.fromEntries(phases.map((phase) => [
    phase, phaseBudget(summary[phase]),
  ]));
  const stabilityFailures = phases.flatMap((phase) => (
    summary[phase].stability.flipped.map((kind) => `cpu-stability-${phase}-${kind}`)
  ));
  const budgetFailures = Object.entries(budgets)
    .filter(([, value]) => value.status !== "pass").map(([phase]) => `cpu-budget-${phase}`);
  return {
    budgets,
    failures: stabilityFailures.length ? stabilityFailures : budgetFailures,
    status: stabilityFailures.length ? "invalid" : budgetFailures.length ? "fail" : "pass",
    summary,
  };
}

async function cpuProbe(pid, port, idleDurationMs, phases) {
  const snapshot = () => readOwnedCpuSnapshot(pid);
  const common = {
    intervalMs: 500,
    maximumExternalCpu: MAX_EXTERNAL_CPU_POINTS,
    snapshot,
    systemSnapshot: readSystemCpuSnapshot,
  };
  const segments = {};
  if (phases.includes("idle")) {
    segments.idle = await sampleCpuSegment({ durationMs: idleDurationMs, ...common });
  }
  for (const phase of phases.filter((name) => name !== "idle")) {
    segments[phase] = await sampleCpuSegment({
      action: () => runRendererSegment(port, phase),
      durationMs: 15_000,
      ...common,
    });
  }
  return segments;
}

async function runCpuAttempt({ electron, idleDurationMs, modules, selectedPhases }) {
  const envelope = await createRunEnvelope();
  const runs = [];
  try {
    for (const mode of ORDER) {
      const adapter = createElectronAppAdapter({
        cpuProbe: ({ pid, port }) => cpuProbe(pid, port, idleDurationMs, selectedPhases),
        electron,
        envelope,
        fixtureDeadlineMs: 120_000,
        mode,
        modules,
      });
      const result = await runAppProbe({
        adapter, mode, request: { expectedModules: modules },
      });
      runs.push({ cpu: adapter.cpu, mode, result });
    }
    return { ...evaluateAppCpuPerformance(runs, { phases: selectedPhases }), runs };
  } finally {
    await envelope.cleanup();
  }
}

export async function runAppCpuAB({
  idleDurationMs = 30_000, maxAttempts = 2, modules, phases,
} = {}) {
  const selectedPhases = normalizeCpuPhases(phases);
  const electron = await discoverTestElectron();
  const outcome = await runBoundedCpuAttempts(() => runCpuAttempt({
    electron, idleDurationMs, modules, selectedPhases,
  }), { maxAttempts });
  return {
    schema: "codexctl-app-cpu/1",
    ...outcome.result,
    attemptCount: outcome.attempts.length,
    attemptStatuses: outcome.statuses,
    attempts: outcome.attempts,
  };
}

export { ORDER as CPU_AB_ORDER, PHASES as CPU_PHASES };
