import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForMacPreloadResult } from "../src/macos-preload-runtime.mjs";
import preloadBudget from "../src/macos-preload-budget.cjs";

function result(pid, overrides = {}) {
  return {
    schema: "codexctl-macos-preload-result/1",
    ok: true,
    pid,
    url: "app://-/index.html",
    completedAt: new Date().toISOString(),
    durationMs: 42,
    promptContext: {
      revision: "a".repeat(24),
      appRoutesReady: true,
      features: { prompt: true, context: true },
      buttonCount: 1,
      contextButtonCount: 1,
      providerIndicatorCount: 1,
      promptButtons: [{ visible: true }],
      contextButtons: [{ visible: true }],
      providerIndicators: [{ visible: true }],
      currentProvider: { id: "polo", status: "resolved" },
      activeTimers: { managerProbe: 1, navigation: 0, toast: 0, bridge: 0 },
      uiMetrics: { mutationBatches: 0, mutationRecords: 0 },
    },
    wallpaper: {
      revision: "b".repeat(24),
      installed: true,
      artReady: true,
      stylePresent: true,
      rootAttribute: "on",
      observers: 0,
      timers: 0,
    },
    error: null,
    ...overrides,
  };
}

test("macOS preload receipt binds PID, revisions, and performance contract", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-result-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  await fs.writeFile(filename, JSON.stringify(result(1234)), { mode: 0o600 });
  const runtime = {
    modules: { prompt: true, context: true, wallpaper: true },
    promptContext: { revision: "a".repeat(24) },
    wallpaper: { revision: "b".repeat(24) },
  };
  const verified = await waitForMacPreloadResult(filename, 1234, runtime, 200);
  assert.equal(verified.transport, "electron-preload");
  assert.equal(verified.durationMs, 42);
  await assert.rejects(fs.access(filename), /ENOENT/);
});

test("macOS preload receipt rejects a missing or invisible Context control", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-context-ui-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  const invalid = result(1234);
  invalid.promptContext.contextButtonCount = 0;
  invalid.promptContext.contextButtons = [];
  await fs.writeFile(filename, JSON.stringify(invalid), { mode: 0o600 });
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {
      modules: { prompt: true, context: true, wallpaper: false },
      promptContext: { revision: "a".repeat(24) },
    }, 100),
    /Context 控件契约/,
  );
});

test("macOS preload receipt rejects controls observed before final Codex app routes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-app-routes-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  const early = result(1234);
  early.promptContext.appRoutesReady = false;
  await fs.writeFile(filename, JSON.stringify(early), { mode: 0o600 });
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {
      modules: { prompt: true, context: true, wallpaper: false },
      promptContext: { revision: "a".repeat(24) },
    }, 100),
    /最终页面挂载契约/,
  );
});

test("macOS preload accepts an installed dormant runtime when no composer exists yet", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-dormant-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  const dormant = result(1234);
  dormant.promptContext.appRoutesReady = false;
  dormant.promptContext.controlContextAvailable = false;
  dormant.promptContext.buttonCount = 0;
  dormant.promptContext.contextButtonCount = 0;
  dormant.promptContext.providerIndicatorCount = 0;
  dormant.promptContext.promptButtons = [];
  dormant.promptContext.contextButtons = [];
  dormant.promptContext.providerIndicators = [];
  await fs.writeFile(filename, JSON.stringify(dormant), { mode: 0o600 });
  const verified = await waitForMacPreloadResult(filename, 1234, {
    modules: { prompt: true, context: true, wallpaper: false },
    promptContext: { revision: "a".repeat(24) },
  }, 100);
  assert.equal(verified.promptContext.controlContextAvailable, false);
  assert.equal(verified.promptContext.buttonCount, 0);
});

test("macOS preload receipt rejects a different process", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-pid-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  await fs.writeFile(filename, JSON.stringify(result(4321)), { mode: 0o600 });
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {}, 100),
    /身份不匹配/,
  );
});

test("macOS preload receipt rejects Prompt/Context background work", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-prompt-perf-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  const invalid = result(1234);
  invalid.promptContext.activeTimers.navigation = 2;
  await fs.writeFile(filename, JSON.stringify(invalid), { mode: 0o600 });
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {
      promptContext: { revision: "a".repeat(24) },
    }, 100),
    /Prompt\/Context 性能契约/,
  );
});

test("[INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002] a definitive failure receipt returns immediately", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  await fs.writeFile(filename, JSON.stringify(result(1234, {
    ok: false,
    error: "bounded failure; stage=prompt-context-ready; navigations=1; elapsedMs=5000",
  })), { mode: 0o600 });
  const startedAt = Date.now();
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {}, 2_000),
    /stage=prompt-context-ready; navigations=1; elapsedMs=5000/,
  );
  assert.ok(Date.now() - startedAt < 250, "atomic failure receipt must not be polled again");
});

test("[INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002] a missing receipt reports its final wait phase", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-missing-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "result.json");
  await assert.rejects(
    waitForMacPreloadResult(filename, 1234, {}, 30),
    /stage=awaiting-result; navigations=unknown; elapsedMs=\d+/,
  );
});

test("shared preload budget keeps every inner phase below the parent transaction", () => {
  assert.equal(
    preloadBudget.TRANSACTION_TIMEOUT_MS,
    preloadBudget.HOOK_TIMEOUT_MS + preloadBudget.RESULT_HANDOFF_TIMEOUT_MS,
  );
  assert.ok(preloadBudget.CONTROL_READY_TIMEOUT_MS < preloadBudget.HOOK_TIMEOUT_MS);
  assert.ok(
    preloadBudget.CONTROL_NAVIGATION_TIMEOUT_MS
      + preloadBudget.CONTROL_FINAL_REPAIR_SETTLE_TIMEOUT_MS
      < preloadBudget.HOOK_TIMEOUT_MS,
  );
});
