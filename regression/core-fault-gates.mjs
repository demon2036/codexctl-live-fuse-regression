import { evaluateBudget } from "./budgets.mjs";
import { evaluateAppFaultChecks } from "./app-faults.mjs";

export function evaluateProviderProtection({ after, before, launchDescription }) {
  const failures = [];
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after) || !before.equals(after)) {
    failures.push("config-bytes-changed");
  }
  if (/\bcrs\b|model_provider/i.test(String(launchDescription ?? ""))) {
    failures.push("provider-injected");
  }
  return { failures, status: failures.length ? "fail" : "pass" };
}

export function evaluateCoreFaultInjection({ appFaultResults, budgetSample, provider }) {
  const app = evaluateAppFaultChecks(appFaultResults);
  const budget = evaluateBudget("input", budgetSample);
  const providerResult = evaluateProviderProtection(provider);
  const expected = {
    anchor: appFaultResults?.find(({ fault }) => fault === "anchor"),
    bottom: appFaultResults?.find(({ fault }) => fault === "bottom-black"),
    cleanup: appFaultResults?.find(({ fault }) => fault === "cleanup"),
    remote: appFaultResults?.find(({ fault }) => fault === "remote"),
  };
  const failures = [];
  if (app.status !== "pass") failures.push(...app.failures);
  if (budget.status !== "fail" || !budget.failures.includes("interaction p95 exceeded budget")) {
    failures.push("false-green-budget");
  }
  if (providerResult.status !== "fail") failures.push("false-green-provider");
  for (const [name, result] of Object.entries(expected)) {
    if (result?.status !== "fail") failures.push(`false-green-${name}`);
  }
  return {
    failures,
    gates: { app, budget, provider: providerResult },
    status: failures.length ? "fail" : "pass",
  };
}
