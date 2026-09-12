import { validControlObservations } from "./control-observations.mjs";

function add(failures, condition, code) {
  if (condition) failures.push(code);
}

export function evaluateAppInteractions(value = {}) {
  const failures = [];
  for (const [field, actual] of Object.entries(value.prompt ?? {})) {
    add(failures, actual !== true, `prompt-${field}`);
  }
  const context = value.context ?? {};
  for (const field of [
    "activeAppliedBeforeTurn", "activeLabelCurrentThread", "copyClean",
    "failureRolledBack", "idempotentNoRequest", "largeVerified", "nativeNoOverride",
    "retryRecovered", "shrinkApplied",
  ]) add(failures, context[field] !== true, `context-${field}`);
  add(failures, context.activeCoalescedWindow !== 600000, "context-active-window");
  add(failures, context.immediateOrder !== "thread/read,thread/unsubscribe,thread/resume",
    "context-immediate-order");
  add(failures, context.largeWindow !== 450000 || context.largeCompact !== 400000,
    "context-450k-mapping");
  add(failures, context.oaiWindow !== 272000 || context.oaiEffective !== 258400,
    "context-272k-mapping");
  for (const [field, actual] of Object.entries(value.layout ?? {})) {
    add(failures, actual !== true, `layout-${field}`);
  }
  const stress = value.stress ?? {};
  add(failures, stress.graphAttempts > 1, "stress-manager-graph");
  add(failures, stress.navigationPeakTimers < 1 || stress.navigationPeakTimers > 3,
    "stress-navigation-peak");
  for (const field of [
    "inputEnsureDelta", "inputPositionDelta", "navigationEndTimers",
    "settledTimerCount", "workerCount",
  ]) add(failures, stress[field] !== 0, `stress-${field}`);
  add(failures, !validControlObservations(stress),
    "stress-observerCount");
  add(failures, stress.wallpaperDeltaZero !== true, "stress-wallpaper");
  add(failures, Object.values(stress.hotListeners ?? {}).some((count) => count !== 0),
    "stress-hot-listeners");
  const unique = [...new Set(failures)];
  return { failures: unique, status: unique.length ? "fail" : "pass" };
}
