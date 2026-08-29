export const PERFORMANCE_BUDGETS = Object.freeze({
  "baseline-validity": Object.freeze({ kind: "baseline" }),
  cpu: Object.freeze({ kind: "cpu", medianPoints: 2, p95Points: 5 }),
  input: Object.freeze({ kind: "interaction", maxDeltaMs: 16, p95AbsoluteMs: 2, p95Ratio: 1.15 }),
  scroll: Object.freeze({ kind: "interaction", maxDeltaMs: 16, p95AbsoluteMs: 2, p95Ratio: 1.15 }),
  startup: Object.freeze({ kind: "startup", medianDeltaMs: 750, visibleP95Ms: 750 }),
  "startup-visible": Object.freeze({ kind: "visible", p95Ms: 750 }),
});

function result(status, failures = []) {
  return Object.freeze({ failures: Object.freeze(failures), status });
}

function finiteFields(sample, fields) {
  return fields.every((field) => Number.isFinite(sample?.[field]));
}

function exceeds(value, limit) {
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(limit)) * 8;
  return value - limit > epsilon;
}

function evaluateStartup(budget, sample) {
  const fields = ["injectedMedianMs", "officialMedianMs", "visibleP95Ms"];
  if (!finiteFields(sample, fields)) return result("invalid", ["startup metrics are non-finite"]);
  const failures = [];
  if (exceeds(sample.injectedMedianMs, sample.officialMedianMs + budget.medianDeltaMs)) {
    failures.push("launch median exceeded budget");
  }
  if (exceeds(sample.visibleP95Ms, budget.visibleP95Ms)) failures.push("visible p95 exceeded budget");
  return result(failures.length ? "fail" : "pass", failures);
}

function evaluateInteraction(budget, sample) {
  const fields = ["injectedMaxMs", "injectedP95Ms", "officialMaxMs", "officialP95Ms"];
  if (!finiteFields(sample, fields)) return result("invalid", ["interaction metrics are non-finite"]);
  const p95Limit = Math.max(
    sample.officialP95Ms * budget.p95Ratio,
    sample.officialP95Ms + budget.p95AbsoluteMs,
  );
  const failures = [];
  if (exceeds(sample.injectedP95Ms, p95Limit)) failures.push("interaction p95 exceeded budget");
  if (exceeds(sample.injectedMaxMs, sample.officialMaxMs + budget.maxDeltaMs)) {
    failures.push("interaction max exceeded budget");
  }
  return result(failures.length ? "fail" : "pass", failures);
}

function evaluateCpu(budget, sample) {
  const fields = ["injectedMedian", "injectedP95", "officialMedian", "officialP95"];
  if (!finiteFields(sample, fields)) return result("invalid", ["CPU metrics are non-finite"]);
  const failures = [];
  if (exceeds(sample.injectedMedian, sample.officialMedian + budget.medianPoints)) {
    failures.push("CPU median exceeded budget");
  }
  if (exceeds(sample.injectedP95, sample.officialP95 + budget.p95Points)) {
    failures.push("CPU p95 exceeded budget");
  }
  return result(failures.length ? "fail" : "pass", failures);
}

export function evaluateBudget(key, sample) {
  const budget = PERFORMANCE_BUDGETS[key];
  if (!budget) return result("invalid", [`unknown budget: ${key}`]);
  if (sample?.baselineValid !== true) return result("invalid", ["baseline is invalid"]);
  if (budget.kind === "baseline") return result("pass");
  if (budget.kind === "startup") return evaluateStartup(budget, sample);
  if (budget.kind === "interaction") return evaluateInteraction(budget, sample);
  if (budget.kind === "cpu") return evaluateCpu(budget, sample);
  if (budget.kind === "visible") {
    if (!finiteFields(sample, ["visibleP95Ms"])) return result("invalid", ["visible p95 is non-finite"]);
    return !exceeds(sample.visibleP95Ms, budget.p95Ms)
      ? result("pass") : result("fail", ["visible p95 exceeded budget"]);
  }
  return result("invalid", [`unsupported budget kind: ${budget.kind}`]);
}
