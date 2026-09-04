import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, "src", "macos-preload.cjs");
const FIXTURE = path.join(ROOT, "test-support", "macos-preload-hook-fixture.cjs");
const APP_TRANSACTION = path.join(ROOT, "src", "app-transaction.mjs");

async function runHook(t, {
  readyAtMs,
  navigationAtMs,
  navigationSource = "renderer",
  appRoutesReadyAtMs = readyAtMs,
  controlContextAvailable = true,
  navigationTimersUntilMs = -1,
}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-hook-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const specFile = path.join(directory, "macos-preload.json");
  const resultFile = path.join(directory, "preload-result-11111111-2222-4333-8444-555555555555.json");
  await fs.writeFile(specFile, `${JSON.stringify({
    schema: "codexctl-macos-preload/1",
    promptContext: { payload: "void 0", revision: "a".repeat(24) },
    wallpaper: null,
  })}\n`, { mode: 0o600 });
  const { stdout } = await execFileAsync(process.execPath, [
    FIXTURE,
    HOOK,
    specFile,
    resultFile,
    String(readyAtMs),
    String(navigationAtMs),
    navigationSource,
    String(appRoutesReadyAtMs),
    String(controlContextAvailable),
    String(navigationTimersUntilMs),
  ], { timeout: 2_000 });
  const output = JSON.parse(stdout);
  assert.deepEqual(output.listeners, {
    domReady: 0,
    didStartNavigation: 0,
    didNavigateInPage: 0,
  }, "one-shot preload listeners must be released after its receipt");
  return output.record;
}

test("[INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001] preload follows an in-flight Session navigation past the legacy 5s boundary", async (t) => {
  const record = await runHook(t, { readyAtMs: 6_000, navigationAtMs: 1_000 });
  assert.equal(record.ok, true, record.error);
  assert.ok(record.durationMs >= 6_000);
  assert.equal(record.promptContext.buttonCount, 1);
  assert.equal(record.promptContext.contextButtonCount, 1);
  assert.equal(record.promptContext.providerIndicatorCount, 1);
});

test("preload receipt waits for final Codex app routes after early controls were visible", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 0,
    appRoutesReadyAtMs: 4_700,
    navigationAtMs: -1,
  });
  assert.equal(record.ok, true, record.error);
  assert.ok(record.durationMs >= 4_700, `receipt returned early at ${record.durationMs}ms`);
  assert.equal(record.promptContext.appRoutesReady, true);
  assert.equal(record.promptContext.buttonCount, 1);
  assert.equal(record.promptContext.contextButtonCount, 1);
  assert.equal(record.promptContext.providerIndicatorCount, 1);
});

test("preload allows slow final Codex app routes beyond the legacy control deadline", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 0,
    appRoutesReadyAtMs: 6_000,
    navigationAtMs: -1,
  });
  assert.equal(record.ok, true, record.error);
  assert.ok(record.durationMs >= 6_000, `receipt returned early at ${record.durationMs}ms`);
  assert.equal(record.promptContext.appRoutesReady, true);
});

test("preload accepts a stable dormant runtime when the final route ready event is absent", async (t) => {
  const record = await runHook(t, {
    readyAtMs: -1,
    appRoutesReadyAtMs: -1,
    navigationAtMs: -1,
    controlContextAvailable: false,
  });
  assert.equal(record.ok, true, record.error);
  assert.equal(record.promptContext.appRoutesReady, false);
  assert.equal(record.promptContext.controlContextAvailable, false);
  assert.equal(record.promptContext.buttonCount, 0);
  assert.equal(record.promptContext.contextButtonCount, 0);
  assert.equal(record.promptContext.providerIndicatorCount, 0);
});

test("preload lets a late final route repair drain its bounded navigation timer", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 0,
    appRoutesReadyAtMs: 11_700,
    navigationAtMs: -1,
    navigationTimersUntilMs: 12_400,
  });
  assert.equal(record.ok, true, record.error);
  assert.ok(record.durationMs >= 12_400, `receipt returned early at ${record.durationMs}ms`);
  assert.equal(record.promptContext.appRoutesReady, true);
  assert.equal(record.promptContext.activeTimers.navigation, 0);
});

test("preload does not extend a final route repair beyond its bounded settle allowance", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 0,
    appRoutesReadyAtMs: 11_700,
    navigationAtMs: -1,
    navigationTimersUntilMs: 13_100,
  });
  assert.equal(record.ok, false);
  assert.match(record.error, /final app routes.*bounded/i);
  assert.equal(record.durationMs, 13_000);
});

test("[INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002] preload restarts when navigation strands an in-flight document", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 0,
    navigationAtMs: -1,
    navigationSource: "document-reload-hang",
  });
  assert.equal(record.ok, true, record.error);
  assert.equal(record.promptContext.buttonCount, 1);
  assert.equal(record.promptContext.contextButtonCount, 1);
  assert.equal(record.promptContext.providerIndicatorCount, 1);
});

test("[INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002] parent preload deadline uses the shared bounded budget", async () => {
  const source = await fs.readFile(APP_TRANSACTION, "utf8");
  assert.match(source, /MAC_PRELOAD_TRANSACTION_TIMEOUT_MS/);
  assert.doesNotMatch(source, /preloadTimeoutMs\s*\?\?\s*15_000/);
});

test("preload still fails a permanently missing control at a bounded navigation deadline", async (t) => {
  const record = await runHook(t, {
    readyAtMs: -1,
    appRoutesReadyAtMs: 0,
    navigationAtMs: 0,
  });
  assert.equal(record.ok, false);
  assert.match(record.error, /navigation.*bounded|bounded.*navigation/i);
  assert.ok(record.durationMs > 5_000 && record.durationMs <= 15_000);
});

test("preload does not extend a missing control when no navigation occurred", async (t) => {
  const record = await runHook(t, {
    readyAtMs: -1,
    appRoutesReadyAtMs: 0,
    navigationAtMs: -1,
  });
  assert.equal(record.ok, false);
  assert.match(record.error, /5000ms/);
  assert.match(record.error, /stage=prompt-context/);
  assert.match(record.error, /navigations=0/);
  assert.match(record.error, /elapsedMs=5000/);
  assert.match(record.error, /appRoutesReady=true/);
  assert.match(record.error, /controls=0\/0\/0/);
  assert.match(record.error, /controlContextAvailable=/);
  assert.equal(record.durationMs, 5_000);
});

test("preload observes navigation arriving exactly at the normal deadline", async (t) => {
  const record = await runHook(t, { readyAtMs: 6_000, navigationAtMs: 5_000 });
  assert.equal(record.ok, true, record.error);
  assert.ok(record.durationMs >= 6_000);
});

test("preload follows Electron navigation even before renderer navigation metrics exist", async (t) => {
  const record = await runHook(t, {
    readyAtMs: 6_000,
    navigationAtMs: 1_000,
    navigationSource: "webcontents",
  });
  assert.equal(record.ok, true, record.error);
  assert.equal(record.promptContext.uiMetrics.navigationRepairs, 0);
});
