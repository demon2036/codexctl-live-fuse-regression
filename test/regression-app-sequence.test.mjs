import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAppSequence } from "../regression/app-sequence.mjs";

function run(label, mode = label) {
  const injected = mode === "injected";
  return {
    label,
    result: {
      cleanup: { orphans: [], status: "pass" },
      identity: {
        appVersion: "1.0.0", cliVersion: "1.0.0", profileId: "same-profile",
      },
      mode,
      processTree: {
        appServerCount: 1, controllerCount: 0, duplicatePresence: false,
      },
      remote: { errors: [], status: "connected" },
      status: "pass",
    },
    details: {
      globals: { prompt: injected, wallpaper: injected },
      hostCount: injected ? 1 : 0,
      controlLayout: injected ? {
        host: { left: 525, right: 1020, top: 640, bottom: 668, width: 495, height: 28 },
        permission: { left: 420, right: 520, top: 640, bottom: 668, width: 100, height: 28 },
        controls: [
          { bounds: { left: 525, right: 645, top: 640, bottom: 668, width: 120, height: 28 },
            className: "cbps-control cbps-trigger", lineHeight: "18px", text: "Default" },
          { bounds: { left: 649, right: 769, top: 640, bottom: 668, width: 120, height: 28 },
            className: "cbps-control cbps-trigger cbps-context-trigger", lineHeight: "18px",
            text: "272K" },
          { bounds: { left: 773, right: 873, top: 640, bottom: 668, width: 100, height: 28 },
            className: "cbps-control cbps-trigger cbps-usage-trigger", lineHeight: "18px",
            prefixDisplay: "inline", text: "Usage 79.8%", valueFits: true },
          { bounds: { left: 877, right: 997, top: 640, bottom: 668, width: 120, height: 28 },
            className: "cbps-control cbps-trigger cbps-provider-indicator", lineHeight: "18px",
            text: "polo" },
        ],
      } : { host: null, permission: null, controls: [] },
      promptStyleCount: injected ? 1 : 0,
      wallpaperStyleCount: injected ? 1 : 0,
      promptRevision: injected ? "a".repeat(24) : null,
      wallpaperRevision: injected ? "b".repeat(24) : null,
    },
  };
}

const valid = () => [
  run("official", "official"),
  run("injected-1", "injected"),
  run("official-ab", "official"),
  run("injected-2", "injected"),
  run("injected-repeat", "injected"),
  run("clean", "official"),
  run("official-recovery", "official"),
];

const recovery = () => ({
  appServerCount: 1,
  cleanup: { orphans: [], status: "pass" },
  controllerCount: 0,
  processBoundary: true,
  profileId: "same-profile",
  snapshot: {
    cdp: false, nodeOptions: false, preloadEnvironment: false,
    renderer: {
      globals: { prompt: false, wallpaper: false }, hostCount: 0,
      promptStyleCount: 0, wallpaperStyleCount: 0, workerCount: 0,
      remote: { errors: [], status: "connected" },
    },
  },
});

test("[LAUNCH-REMOTE-INJECTED-002] [INJECTION-ONE-SHOT-CONTROLLER-001] [RECOVERY-CLEAN-RESTART-001] official/injected alternation and full recovery form one strict App sequence", () => {
  assert.deepEqual(evaluateAppSequence(valid(), recovery()), { failures: [], status: "pass" });
});

test("[RECOVERY-HOT-CLEAN-NOT-SUFFICIENT-002] hot renderer cleanup cannot substitute for a full process boundary", () => {
  const value = recovery();
  value.processBoundary = false;
  const result = evaluateAppSequence(valid(), value);
  assert.equal(result.status, "fail");
  assert.ok(result.failures.includes("native-recovery-process-boundary"));
});

test("version skew, Remote errors, duplicate presence, accumulation, and dirty clean all fail", () => {
  for (const mutate of [
    (runs) => { runs[1].result.identity.appVersion = "2.0.0"; },
    (runs) => { runs[1].result.remote.errors = ["websocket-reset"]; },
    (runs) => { runs[1].result.processTree.duplicatePresence = true; },
    (runs) => { runs[4].details.hostCount = 2; },
    (runs) => { runs[5].details.globals.prompt = true; },
  ]) {
    const runs = valid();
    mutate(runs);
    assert.equal(evaluateAppSequence(runs, recovery()).status, "fail");
  }
});

test("an injected sequence rejects a visually clipped Usage value", () => {
  const runs = valid();
  const usage = runs[1].details.controlLayout.controls.find(({ className }) => (
    className.includes("cbps-usage-trigger")
  ));
  usage.valueFits = false;

  const result = evaluateAppSequence(runs, recovery());
  assert.equal(result.status, "fail");
  assert.ok(result.failures.includes("injected-usage-visibility-1"));
});

test("native clean recovery rejects CDP, preload, renderer globals, or workers", () => {
  for (const mutate of [
    (value) => { value.snapshot.cdp = true; },
    (value) => { value.snapshot.preloadEnvironment = true; },
    (value) => { value.snapshot.renderer.globals.wallpaper = true; },
    (value) => { value.snapshot.renderer.workerCount = 1; },
  ]) {
    const value = recovery();
    mutate(value);
    assert.equal(evaluateAppSequence(valid(), value).status, "fail");
  }
});
