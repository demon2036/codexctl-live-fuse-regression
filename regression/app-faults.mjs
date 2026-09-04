import { createRunEnvelope } from "./ownership.mjs";
import { discoverTestElectron } from "./electron-runtime.mjs";
import { createElectronAppAdapter } from "./electron-app-adapter.mjs";
import { runAppProbe } from "./app-probe-contract.mjs";

const FAULTS = Object.freeze([
  Object.freeze({ fault: "bottom-black", reason: "bottom-opaque-black" }),
  Object.freeze({ fault: "anchor", reason: "prompt-control-unreachable" }),
  Object.freeze({ fault: "wallpaper-late", reason: "wallpaper-visible-late" }),
  Object.freeze({ fault: "sidebar-overlap", reason: "sidebar-overlaps-main" }),
  Object.freeze({ fault: "control-duplicate", reason: "prompt-control-count" }),
  Object.freeze({ fault: "remote", reason: "remote-disconnected" }),
  Object.freeze({ fault: "cleanup", reason: "cleanup-failed" }),
]);

export function evaluateAppFaultChecks(results) {
  const failures = [];
  for (const expected of FAULTS) {
    const actual = results?.find(({ fault }) => fault === expected.fault);
    if (!actual) failures.push(`missing-${expected.fault}`);
    else if (actual.status !== "fail" || !actual.reasonCodes?.includes(expected.reason)) {
      failures.push(`false-green-${expected.fault}`);
    }
  }
  return { failures, status: failures.length ? "fail" : "pass" };
}

export async function runAppFaultChecks() {
  const electron = await discoverTestElectron();
  const results = [];
  for (const expected of FAULTS) {
    const envelope = await createRunEnvelope();
    try {
      const adapter = createElectronAppAdapter({
        cleanupFault: expected.fault === "cleanup",
        electron,
        envelope,
        fault: expected.fault === "cleanup" ? null : expected.fault,
        mode: "injected",
      });
      const result = await runAppProbe({ adapter, mode: "injected", request: {} });
      results.push({
        fault: expected.fault,
        reasonCodes: result.reasonCodes,
        status: result.status,
      });
    } finally {
      await envelope.cleanup();
    }
  }
  return { ...evaluateAppFaultChecks(results), results };
}

export { FAULTS as APP_FAULTS };
