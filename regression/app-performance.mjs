import { evaluateBudget } from "./budgets.mjs";
import { percentile, runABSampler } from "./ab-sampler.mjs";
import { createRunEnvelope } from "./ownership.mjs";
import { discoverTestElectron } from "./electron-runtime.mjs";
import { createElectronAppAdapter } from "./electron-app-adapter.mjs";
import { runAppProbe } from "./app-probe-contract.mjs";
import { readSystemCpuSnapshot, systemCpuPercentDelta } from "./cpu-sampler.mjs";

const FIELDS = Object.freeze([
  "launchMs", "visibleMs", "inputP95Ms", "inputMaxMs", "scrollP95Ms", "scrollMaxMs",
  "taskDurationMs", "scriptDurationMs", "styleDurationMs", "layoutDurationMs",
  "longTaskCount", "observerCount", "timerCount", "workerCount",
]);

function metric(summary, mode, field, statistic) {
  return summary?.[mode]?.[field]?.[statistic];
}

function interactionSummary(sampler, mode, field) {
  const records = sampler?.rawSamples?.filter((entry) => entry.included && entry.mode === mode);
  const groups = records?.map((entry) => entry.interactions?.[field]);
  if (!groups?.length || groups.length < 2 || groups.some((values) => (
    !Array.isArray(values) || values.length < 5
    || values.some((value) => !Number.isFinite(value) || value < 0)
  ))) return { max: Number.NaN, p95: Number.NaN };
  const values = groups.flat();
  return { max: Math.max(...values), p95: percentile(values, 0.95) };
}

export function evaluateAppPerformance(sampler) {
  if (sampler?.status !== "pass") return { budgets: {}, status: "invalid" };
  const baselineValid = true;
  const input = {
    injected: interactionSummary(sampler, "injected", "inputLatencyMs"),
    official: interactionSummary(sampler, "official", "inputLatencyMs"),
  };
  const scroll = {
    injected: interactionSummary(sampler, "injected", "scrollLatencyMs"),
    official: interactionSummary(sampler, "official", "scrollLatencyMs"),
  };
  const budgets = {
    startup: evaluateBudget("startup", {
      baselineValid,
      injectedMedianMs: metric(sampler.summary, "injected", "launchMs", "p50"),
      officialMedianMs: metric(sampler.summary, "official", "launchMs", "p50"),
      visibleP95Ms: metric(sampler.summary, "injected", "visibleMs", "p95"),
    }),
    input: evaluateBudget("input", {
      baselineValid,
      injectedMaxMs: input.injected.max,
      injectedP95Ms: input.injected.p95,
      officialMaxMs: input.official.max,
      officialP95Ms: input.official.p95,
    }),
    scroll: evaluateBudget("scroll", {
      baselineValid,
      injectedMaxMs: scroll.injected.max,
      injectedP95Ms: scroll.injected.p95,
      officialMaxMs: scroll.official.max,
      officialP95Ms: scroll.official.p95,
    }),
  };
  const statuses = Object.values(budgets).map(({ status }) => status);
  return {
    budgets,
    status: statuses.includes("invalid") ? "invalid" : statuses.includes("fail") ? "fail" : "pass",
  };
}

export function evaluatePerformanceRepeatability(runs) {
  if (!Array.isArray(runs) || runs.length !== 2) {
    return { failures: ["repeat-count"], status: "invalid" };
  }
  const failures = [];
  const conclusions = runs.map((run) => JSON.stringify(Object.fromEntries(
    Object.entries(run.budgets ?? {}).map(([key, value]) => [key, value.status]),
  )));
  if (runs.some(({ sampler, status }) => sampler?.status !== "pass" || status !== "pass")) {
    failures.push("repeat-non-pass");
  }
  if (conclusions[0] !== conclusions[1]) failures.push("repeat-conclusion-flip");
  return { failures, status: failures.length ? "fail" : "pass" };
}

export function normalizedSystemCpuLoad(before, after) {
  const cpuPoints = systemCpuPercentDelta(before, after);
  const cores = Array.isArray(before) ? before.length : 0;
  return Number.isFinite(cpuPoints) && cores > 0 ? cpuPoints / (cores * 100) : Number.NaN;
}

export async function runAppPerformanceAB({
  groups = 2,
  maxGroupAttempts = 2,
  warmups = 1,
} = {}) {
  const envelope = await createRunEnvelope();
  const electron = await discoverTestElectron();
  try {
    const sampler = await runABSampler({
      fields: FIELDS,
      groups,
      maxGroupAttempts,
      warmups,
      async measure({ groupAttempt, groupIndex, mode, phase, sampleIndex }) {
        const systemBefore = readSystemCpuSnapshot();
        const label = `${mode}-${phase}-${Math.max(0, groupIndex)}-${groupAttempt}-${sampleIndex}`;
        const adapter = createElectronAppAdapter({
          benchmarkOptions: { label, scrollSteps: 20, typingIntervalMs: 5 },
          electron,
          envelope,
          mode,
        });
        const result = await runAppProbe({ adapter, mode, request: {} });
        const systemAfter = readSystemCpuSnapshot();
        const benchmark = adapter.benchmark;
        return {
          environment: {
            appVersion: result.identity.appVersion,
            probePassed: result.status === "pass" && result.cleanup.status === "pass",
            profileId: result.identity.profileId,
            remoteConnected: result.remote.status === "connected" && result.remote.errors.length === 0,
            systemLoad: normalizedSystemCpuLoad(systemBefore, systemAfter),
          },
          metrics: {
            inputMaxMs: benchmark.input.maxMs,
            inputP95Ms: benchmark.input.p95Ms,
            launchMs: adapter.launchDurationMs,
            layoutDurationMs: benchmark.performance.layoutDurationMs,
            longTaskCount: benchmark.longTasks.samples,
            observerCount: result.metrics.observerCount,
            scriptDurationMs: benchmark.performance.scriptDurationMs,
            scrollMaxMs: benchmark.scroll.maxMs ?? 0,
            scrollP95Ms: benchmark.scroll.p95Ms ?? 0,
            styleDurationMs: benchmark.performance.recalcStyleDurationMs,
            taskDurationMs: benchmark.performance.taskDurationMs,
            timerCount: result.metrics.timerCount,
            visibleMs: mode === "injected" ? result.visual.wallpaperVisibleMs : 0,
            workerCount: result.metrics.workerCount,
          },
          interactions: {
            inputLatencyMs: benchmark.input.values,
            scrollLatencyMs: benchmark.scroll.values,
          },
        };
      },
    });
    return {
      schema: "codexctl-app-performance/1",
      ...evaluateAppPerformance(sampler),
      sampler,
    };
  } finally {
    await envelope.cleanup();
  }
}

export { FIELDS as APP_PERFORMANCE_FIELDS };
