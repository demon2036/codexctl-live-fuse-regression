const STATISTICS = Object.freeze(["max", "p50", "p95"]);
const REASON_CODE = /^[a-z][a-z0-9-]{1,79}$/;

function finiteMetrics(value) {
  return Object.fromEntries(STATISTICS.map((name) => [
    name, Number.isFinite(value?.[name]) ? value[name] : null,
  ]));
}

function compactMode(value) {
  const metrics = finiteMetrics(value);
  const kinds = Object.fromEntries(Object.entries(value?.kinds ?? {}).map(
    ([name, summary]) => [name, finiteMetrics(summary)],
  ));
  const work = Object.fromEntries(Object.entries(value?.work ?? {}).map(
    ([name, summary]) => [name, finiteMetrics(summary)],
  ));
  return {
    ...metrics,
    ...(Object.keys(kinds).length ? { kinds } : {}),
    ...(Object.keys(work).length ? { work } : {}),
  };
}

export function compactCpuEvidence(cpu) {
  const invalidReasonCodes = [...new Set((Array.isArray(cpu?.attempts) ? cpu.attempts : [])
    .filter(({ status }) => status === "invalid")
    .flatMap(({ failures }) => Array.isArray(failures) ? failures : [])
    .filter((code) => REASON_CODE.test(code)))].sort();
  const measurements = Object.fromEntries(Object.entries(cpu?.summary ?? {}).map(
    ([phase, modes]) => [phase, {
      injected: compactMode(modes?.injected),
      official: compactMode(modes?.official),
      ...(modes?.stability ? { stability: {
        kinds: Object.fromEntries(Object.entries(modes.stability.kinds ?? {}).map(
          ([name, value]) => [name, [...(value.statuses ?? [])]],
        )),
        status: modes.stability.status,
      } } : {}),
    }],
  ));
  const budgets = Object.fromEntries(Object.entries(cpu?.budgets ?? {}).map(
    ([phase, result]) => [phase, {
      kinds: Object.fromEntries(Object.entries(result?.kinds ?? {}).map(
        ([name, value]) => [name, value?.status ?? "invalid"],
      )),
      status: result?.status ?? "invalid",
    }],
  ));
  return {
    attemptCount: Number.isSafeInteger(cpu?.attemptCount) ? cpu.attemptCount : null,
    attemptStatuses: Array.isArray(cpu?.attemptStatuses) ? [...cpu.attemptStatuses] : [],
    budgets,
    failures: Array.isArray(cpu?.failures) ? [...cpu.failures] : ["cpu-result-missing"],
    invalidReasonCodes,
    measurements,
    status: cpu?.status ?? "invalid",
  };
}

export function compactInteractionEvidence(run, index) {
  const invalidReasonCodes = [...new Set((run?.sampler?.rawSamples ?? [])
    .filter(({ phase }) => phase === "sample")
    .map(({ reasonCode }) => String(reasonCode ?? "").replace(/^group-/, ""))
    .filter((code) => REASON_CODE.test(code)))].sort();
  return {
    attempts: Number.isSafeInteger(run?.sampler?.attempts) ? run.sampler.attempts : 0,
    budgets: Object.fromEntries(Object.entries(run?.budgets ?? {}).map(
      ([key, value]) => [key, value?.status ?? "invalid"],
    )),
    completedGroups: Number.isSafeInteger(run?.sampler?.completedGroups)
      ? run.sampler.completedGroups : 0,
    index,
    invalidReasonCodes,
    status: run?.status ?? "invalid",
  };
}
