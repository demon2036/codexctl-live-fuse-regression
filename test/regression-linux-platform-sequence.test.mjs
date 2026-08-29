import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_CPU_PHASES } from "../regression/platform-performance.mjs";
import { evaluateLinuxPlatformSequence } from "../regression/linux-platform-sequence.mjs";

function segment(value = 1) {
  const sample = { main: value, other: value, renderer: value, total: value * 3 };
  return { actionResult: { longTaskCount: 0 }, raw: [{ ...sample }, { ...sample }],
    status: "pass", summary: {
      main: { p95: value }, renderer: { p95: value }, total: { p95: value * 3 },
    } };
}

function run(pid, mode, overrides = {}) {
  return {
    appServerCount: 1,
    benchmark: { input: { maxMs: 5, p95Ms: 4 }, longTasks: { samples: 0 }, restored: true,
      scroll: { maxMs: 6, p95Ms: 5 } },
    cleanup: { orphans: [], portClosed: true, status: "pass" },
    cliExecutable: "codex",
    contract: { failures: [], status: "pass" },
    controllerCount: 0,
    cpu: Object.fromEntries(PLATFORM_CPU_PHASES.map((phase) => [phase, segment()])),
    injectionTransport: mode === "injected" ? "cdp" : null,
    launchMs: 1000,
    mode,
    packageExecutable: "ChatGPT",
    processId: pid,
    reasonCodes: [],
    remote: "connected",
    status: "pass",
    visibleMs: mode === "injected" ? 100 : 0,
    ...overrides,
  };
}

test("Linux actual sequence requires clean official/injected/recovery and all performance budgets", () => {
  const result = evaluateLinuxPlatformSequence({
    official: run(101, "official"),
    injected: run(202, "injected"),
    recovery: run(303, "official"),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.performance.status, "pass");
});

test("Linux actual sequence propagates missing interactive state as unverified", () => {
  const unavailable = run(202, "injected", {
    reasonCodes: ["interactive-shell-unavailable"], status: "unverified",
  });
  const result = evaluateLinuxPlatformSequence({
    official: run(101, "official"), injected: unavailable, recovery: run(303, "official"),
  });
  assert.equal(result.status, "unverified");
  assert.ok(result.reasonCodes.includes("injected-interactive-shell-unavailable"));
});

test("Linux actual sequence rejects identity, Remote, cleanup, and process-boundary faults", () => {
  const result = evaluateLinuxPlatformSequence({
    official: run(101, "official"),
    injected: run(101, "injected", { remote: "disconnected" }),
    recovery: run(303, "official", {
      cleanup: { orphans: [{ kind: "test", pid: 9 }], portClosed: false, status: "fail" },
      packageExecutable: "Codex",
    }),
  });
  assert.equal(result.status, "fail");
  for (const code of ["injected-remote", "recovery-cleanup", "package-identity-mismatch",
    "recovery-process-boundary"]) assert.ok(result.failures.includes(code), code);
});
