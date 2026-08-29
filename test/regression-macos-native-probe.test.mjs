import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateMacNativeProbe, runMacNativeProbe } from "../regression/macos-native-probe.mjs";
import { evaluateMacNativeWorkload } from "../regression/macos-native-performance.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const identity = Object.freeze({
  command: "/private/tmp/codexctl-fixture/MacProbeFixture",
  pid: 7123,
  startedAt: "Thu Aug 27 12:00:00 2026",
});

function envelope() {
  return { processes: new Map([[identity.pid, identity]]) };
}

function nativeResult(overrides = {}) {
  return {
    schema: "codexctl-macos-native-probe/1",
    pid: identity.pid,
    activation: {
      activeBefore: false,
      hiddenAfter: false,
      hiddenBefore: true,
      requested: true,
      succeeded: true,
      unhideRequested: true,
    },
    windowServer: {
      bounds: { height: 700, width: 1000, x: 20, y: 30 },
      count: 1,
      onScreenCount: 1,
    },
    permissions: { accessibility: true, screenRecording: true },
    window: { bounds: { height: 700, width: 1000, x: 20, y: 30 } },
    composer: {
      bounds: { height: 96, width: 640, x: 260, y: 580 },
      found: true, inputRestored: true, inputVerified: true,
      latenciesMs: Array.from({ length: 20 }, (_, index) => 1 + index / 100),
    },
    sessions: {
      bounds: { height: 640, width: 220, x: 20, y: 30 },
      found: true, scrollRestored: true, scrollVerified: true,
      latenciesMs: Array.from({ length: 20 }, (_, index) => 2 + index / 100),
    },
    screenshot: { captured: true },
    ...overrides,
  };
}

function transport(result = nativeResult()) {
  const calls = { starts: 0, stops: 0 };
  return {
    calls,
    value: {
      async start() {
        calls.starts += 1;
        return { result: Promise.resolve(result), stop: async () => { calls.stops += 1; } };
      },
    },
  };
}

test("[TDD-UNAUTOMATABLE-BOUNDARY-002] native probe exposes a deterministic fake boundary before touching an App", async () => {
  const driver = transport();
  await assert.rejects(
    runMacNativeProbe({
      envelope: envelope(), pid: 7999, protectedPids: new Set(),
      readProcess: async () => ({ ...identity, pid: 7999 }), transport: driver.value,
    }),
    /unknown process PID 7999/,
  );
  assert.equal(driver.calls.starts, 0);
});

test("native probe rejects a protected primary PID before transport start", async () => {
  const driver = transport();
  await assert.rejects(
    runMacNativeProbe({
      envelope: envelope(), pid: identity.pid, protectedPids: new Set([identity.pid]),
      readProcess: async () => identity, transport: driver.value,
    }),
    /protected primary PID 7123/,
  );
  assert.equal(driver.calls.starts, 0);
});

test("native probe verifies composer, Sessions, bounds, screenshot, and stop cleanup", async () => {
  const driver = transport();
  const result = await runMacNativeProbe({
    envelope: envelope(), pid: identity.pid, protectedPids: new Set(),
    readProcess: async () => identity, transport: driver.value,
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.composer.inputVerified, true);
  assert.equal(result.composer.inputRestored, true);
  assert.equal(result.composer.latenciesMs.length, 20);
  assert.equal(result.sessions.scrollVerified, true);
  assert.equal(result.sessions.scrollRestored, true);
  assert.equal(result.sessions.latenciesMs.length, 20);
  assert.deepEqual(result.window.bounds, { height: 700, width: 1000, x: 20, y: 30 });
  assert.equal(result.screenshot.captured, true);
  assert.deepEqual(result.cleanup, { stopped: true });
  assert.equal(driver.calls.starts, 1);
  assert.equal(driver.calls.stops, 1);
});

test("missing native permissions are explicit unverified and do not fake interaction", async () => {
  const driver = transport(nativeResult({
    permissions: { accessibility: false, screenRecording: false },
    composer: { bounds: null, found: false, inputRestored: false, inputVerified: false },
    sessions: { bounds: null, found: false, scrollRestored: false, scrollVerified: false },
    screenshot: { captured: false },
  }));
  const result = await runMacNativeProbe({
    envelope: envelope(), pid: identity.pid, protectedPids: new Set(),
    readProcess: async () => identity, transport: driver.value,
  });
  assert.equal(result.status, "unverified");
  assert.deepEqual(result.reasonCodes, ["permission-accessibility", "permission-screen-recording"]);
  assert.equal(result.cleanup.stopped, true);
});

test("native transport is stopped when result collection fails", async () => {
  let stops = 0;
  const driver = {
    async start() {
      return {
        result: Promise.reject(new Error("native result deadline")),
        stop: async () => { stops += 1; },
      };
    },
  };
  await assert.rejects(runMacNativeProbe({
    envelope: envelope(), pid: identity.pid, protectedPids: new Set(),
    readProcess: async () => identity, transport: driver,
  }), /native result deadline/);
  assert.equal(stops, 1);
});

test("native result cannot claim a different PID", () => {
  assert.throws(() => evaluateMacNativeProbe(
    nativeResult({ pid: 7999 }), identity.pid,
  ), /native probe PID mismatch: 7999/);
});

test("[PLATFORM-MACOS-INTERACTIVE-ACTIVATION-006] owned App must activate before native interaction", () => {
  const result = evaluateMacNativeProbe(nativeResult({
    activation: { requested: true, succeeded: false },
  }), identity.pid);
  assert.equal(result.status, "fail");
  assert.ok(result.reasonCodes.includes("app-activation"));
});

test("owned App cannot pass while its exact process remains hidden", () => {
  const result = evaluateMacNativeProbe(nativeResult({
    activation: {
      activeBefore: false, hiddenAfter: true, hiddenBefore: true,
      requested: true, succeeded: true, unhideRequested: true,
    },
  }), identity.pid);
  assert.equal(result.status, "fail");
  assert.ok(result.reasonCodes.includes("app-activation"));
});

test("an already visible App does not claim that unhide was requested", () => {
  const result = evaluateMacNativeProbe(nativeResult({
    activation: {
      activeBefore: true, hiddenAfter: false, hiddenBefore: false,
      requested: true, succeeded: true, unhideRequested: false,
    },
  }), identity.pid);
  assert.equal(result.status, "pass");
});

test("owned macOS probe requires an exact-PID WindowServer surface", () => {
  const missing = evaluateMacNativeProbe(nativeResult({ windowServer: null }), identity.pid);
  assert.equal(missing.status, "fail");
  assert.ok(missing.reasonCodes.includes("window-server-window"));
  assert.ok(missing.reasonCodes.includes("window-server-onscreen"));
});

test("native workload evidence is PID/phase bound and requires reversible real operations", () => {
  const raw = {
    schema: "codexctl-macos-native-workload/1", pid: identity.pid, phase: "input",
    durationMs: 12_001, operations: 480, restored: true, verified: true,
  };
  assert.equal(evaluateMacNativeWorkload(raw, { phase: "input", pid: identity.pid }).status, "pass");
  assert.deepEqual(
    evaluateMacNativeWorkload({ ...raw, restored: false }, { phase: "input", pid: identity.pid }),
    { phase: "input", pid: identity.pid,
      reasonCodes: ["native-workload-unavailable"], status: "unverified" },
  );
});

test("macOS native probe and fixture compile without launching an App", () => {
  const probeSources = [
    path.join(ROOT, "native", "macos-app-probe.swift"),
    path.join(ROOT, "native", "macos-window-probe.swift"),
    path.join(ROOT, "native", "macos-app-workloads.swift"),
  ];
  const fixture = path.join(ROOT, "test-support", "macos-native-probe-fixture.swift");
  if (process.platform !== "darwin") {
    for (const source of [...probeSources, fixture]) assert.match(source, /\.swift$/);
    return;
  }
  const probe = spawnSync("/usr/bin/xcrun", [
    "swiftc", "-parse-as-library", "-typecheck", ...probeSources,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const fixtureResult = spawnSync("/usr/bin/xcrun", ["swiftc", "-typecheck", fixture], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(fixtureResult.status, 0, fixtureResult.stderr || fixtureResult.stdout);
});
