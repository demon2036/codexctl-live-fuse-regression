import { evaluatePlatformPerformance } from "./platform-performance.mjs";

function prefixed(target, prefix, values) {
  for (const value of values ?? []) target.push(`${prefix}-${value}`);
}

export function evaluateLinuxPlatformSequence({ injected, official, recovery } = {}) {
  const failures = [];
  const unverified = [];
  for (const [name, run] of Object.entries({ official, injected, recovery })) {
    if (!run) {
      failures.push(`${name}-missing`);
      continue;
    }
    if (run.status === "fail") prefixed(failures, name, run.reasonCodes);
    if (run.status === "unverified") prefixed(unverified, name, run.reasonCodes);
    if (run.cleanup?.status !== "pass" || run.cleanup?.portClosed !== true) {
      failures.push(`${name}-cleanup`);
    }
    if (run.appServerCount !== 1) failures.push(`${name}-app-server-count`);
    if (run.controllerCount !== 0) failures.push(`${name}-controller-count`);
    if (run.remote !== "connected") failures.push(`${name}-remote`);
    if (run.contract?.status !== "pass") failures.push(`${name}-contract`);
  }
  if (injected?.injectionTransport !== "cdp") failures.push("injected-transport");
  if (official?.injectionTransport !== null || recovery?.injectionTransport !== null) {
    failures.push("official-injection-residue");
  }
  if (official?.packageExecutable !== injected?.packageExecutable
    || official?.packageExecutable !== recovery?.packageExecutable) {
    failures.push("package-identity-mismatch");
  }
  if (official?.cliExecutable !== injected?.cliExecutable
    || official?.cliExecutable !== recovery?.cliExecutable) {
    failures.push("cli-identity-mismatch");
  }
  const pids = [official, injected, recovery].map(({ processId } = {}) => processId);
  if (pids.some((pid) => !Number.isSafeInteger(pid)) || new Set(pids).size !== 3) {
    failures.push("recovery-process-boundary");
  }
  const performance = evaluatePlatformPerformance({ official, injected, recovery });
  if (performance.status === "fail") prefixed(failures, "performance", performance.reasonCodes);
  if (performance.status === "unverified") {
    prefixed(unverified, "performance", performance.reasonCodes);
  }
  const failureCodes = [...new Set(failures)].sort();
  const reasonCodes = [...new Set([...failures, ...unverified])].sort();
  return {
    failures: failureCodes,
    performance,
    reasonCodes,
    status: failureCodes.length ? "fail" : unverified.length ? "unverified" : "pass",
  };
}

