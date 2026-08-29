#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makePayload } from "../test-support/prompt-renderer-harness.mjs";
import { contextBrowserFixture } from "./context-browser-fixture.mjs";
import {
  browserCandidates,
  chromeArgs,
  dumpDom,
  firstExecutable,
  resultFromDump,
} from "./browser-runner-support.mjs";
import {
  loadControlCss,
  loadWallpaperFixturePayload,
  wallpaperFixtureHtml,
} from "./browser-wallpaper-fixture.mjs";
import { regressionCaseById } from "../regression/catalog/index.mjs";

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes("--json");
const help = rawArgs.includes("--help");
const caseIndex = rawArgs.indexOf("--case");
const selectedCase = caseIndex >= 0 ? rawArgs[caseIndex + 1] : null;
const faultArg = rawArgs.find((value) => value.startsWith("--fault="));
const fault = faultArg?.slice("--fault=".length) ?? null;
const consumed = new Set(["--json", "--help", faultArg, "--case", selectedCase].filter(Boolean));
const unknown = rawArgs.filter((value) => !consumed.has(value));
if (help) {
  console.log("Usage: browser-regression.mjs [--case CASE-ID] [--json] [--fault=bottom-selector]");
  process.exit(0);
}
if (unknown.length || (fault && fault !== "bottom-selector")) {
  throw new Error("Usage: browser-regression.mjs [--case CASE-ID] [--json] [--fault=bottom-selector]");
}
if (selectedCase) {
  const entry = regressionCaseById.get(selectedCase);
  if (!entry) throw new Error(`Unknown regression case: ${selectedCase}`);
  if (!entry.layers.includes("L3")) throw new Error(`Case ${selectedCase} has no browser layer`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await firstExecutable(browserCandidates);
const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-browser-regression-"));
let report;

function assertTransparent(value, label) {
  assert.equal(value, "rgba(0, 0, 0, 0)", `${label} must be transparent`);
}

function assertWallpaper(result, expectedWidth) {
  assert.equal(result.nativeAnchorAttribute, null, "native Permissions must remain unmodified");
  assert.equal(result.hostPointerEvents, "none", "only custom control children may receive input");
  assert.ok(Math.abs(result.anchor.first.left - 275) < 0.5,
    `anchored left was ${result.anchor.first.left}`);
  assert.ok(Math.abs(result.anchor.first.top - 120) < 0.5,
    `initial anchored top was ${result.anchor.first.top}`);
  assert.ok(Math.abs(result.anchor.second.top - 260) < 0.5,
    `moved anchored top was ${result.anchor.second.top}`);
  assert.equal(result.diagnostics.installed, true);
  assert.equal(result.diagnostics.artReady, true);
  assert.equal(result.diagnostics.stylePresent, true);
  assert.equal(result.diagnostics.metrics.observers, 0);
  assert.equal(result.diagnostics.metrics.timers, 0);
  assert.equal(result.forbiddenCss, false);
  assert.deepEqual(result.stressDelta, {
    layoutReads: 0,
    mutationBatches: 0,
    mutationRecords: 0,
    observers: 0,
    reconciles: 0,
    timers: 0,
  });
  assert.equal(result.states.length, 3);
  for (const state of result.states) {
    assert.equal(state.viewport.width, expectedWidth);
    assert.ok(state.viewport.height >= 400, `unexpected viewport height ${state.viewport.height}`);
    assert.ok(state.scrollbarGutter >= 0 && state.scrollbarGutter <= 32,
      `${state.label} invalid scrollbar gutter ${state.scrollbarGutter}`);
    assert.equal(state.viewport.width - state.layoutViewport.width, state.scrollbarGutter);
    assert.equal(state.documentWidth, state.layoutViewport.width,
      `${state.label} must not create horizontal overflow`);
    assert.ok(state.documentHeight >= state.viewport.height,
      `${state.label} document did not naturally cover the viewport`);
    assert.equal(state.rootAttribute, "active");
    assert.match(state.htmlBackground, /blob:/);
    assert.match(state.htmlBackground, /rgba\(7, 25, 29, 0\.21\)/);
    assert.match(state.htmlPosition, /72% 54%/);
    assert.equal(state.planeBackground, "none");
    assert.equal(state.planeContain, "none");
    assert.equal(state.htmlIsolation, "auto");
    assert.equal(state.rootIsolation, "auto");
    assertTransparent(state.mainBackground, `${state.label} main surface`);
    assert.match(state.mainImage, /linear-gradient/);
    assertTransparent(state.bottomBackground, `${state.label} bottom panel`);
    assertTransparent(state.bottomSurfaceBackground, `${state.label} bottom surface`);
    assert.equal(state.bottomImage, "none");
    assert.equal(state.threadFadeImage, "none");
    assert.equal(state.threadContain, "none");
    assert.equal(state.sidebarContain, "none");
    assert.equal(state.sidebarWillChange, "auto");
    assert.equal(state.composerContain, "none");
    assert.match(state.sidebarBackground, /rgba\(7, 25, 29, 0\.18\)/);
  }
  assert.ok(result.states.find(({ label }) => label === "long").documentHeight
    > result.states[0].viewport.height, "long content must be scrollable");
  const multiline = result.states.find(({ label }) => label === "multiline");
  assert.match(multiline.composerBackground, /rgba\(11, 36, 42, 0\.76\)/);
  assertTransparent(multiline.composerPlaneBackground, "unused composer pseudo layer");
  assert.equal(multiline.composerPlaneContain, "none");
  const { collapsedMain, expandedMain, expandedSidebar } = result.sidebarLayout;
  assert.ok(expandedSidebar.right <= expandedMain.left + 0.5,
    "docked Sidebar must not overlap Main");
  assert.ok(expandedMain.width < collapsedMain.width,
    "expanded Sidebar must reduce Main width");
  assert.equal(result.floating.background, "rgb(17, 17, 17)");
  assert.equal(result.floating.image, "none");
  assert.equal(result.floating.innerBackground, "rgb(17, 17, 17)");
  assert.equal(result.floating.selectorThemed, false);
}

function assertContext(result, expectedWidth) {
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.viewport.width, expectedWidth);
  assert.equal(result.managerStatus, "ready");
  assert.equal(result.mutationObserverCount, 0);
  assert.equal(result.firstPromptPath === null, false);
  assert.equal(result.secondPromptPath, null);
  assert.equal(result.promptResetToDefault, true);
  assert.equal(result.historicalPrompt, "original");
  assert.equal(result.nativeCopyIsClean, true);
  assert.equal(result.largeWindow, 450000);
  assert.equal(result.largeCompact, 400000);
  assert.equal(result.largeVerified, true);
  assert.equal(result.idempotentNoRequests, true);
  assert.equal(result.shrinkRejectedBeforeRequest, true);
  assert.equal(result.oaiWindow, 272000);
  assert.equal(result.oaiVerified, true);
  assert.equal(result.nativeHasWindowOverride, false);
  assert.equal(result.nativeCurrent, "native");
  assert.match(result.queuedLabel, /400K.*本轮后应用/);
  assert.deepEqual(result.queuedMethods,
    ["thread/read", "thread/unsubscribe", "thread/resume", "turn/start"]);
  assert.equal(result.queuedWindow, 400000);
  assert.equal(result.queuedDrained, true);
  assert.equal(result.rejectedFreshRolledBack, true);
  assert.equal(result.staleActiveAppliedImmediately, true);
  assert.equal(result.staleActiveWindow, 600000);
  assert.equal(result.resizeObserverCount, 0);
  assert.equal(result.intervalCount, 0);
  assert.deepEqual(result.hotListenerCounts, { beforeinput: 0, input: 0, scroll: 0 });
  assert.deepEqual({
    hostCount: result.controls.hostCount,
    promptCount: result.controls.promptCount,
    contextCount: result.controls.contextCount,
  }, { hostCount: 1, promptCount: 1, contextCount: 1 });
  assert.equal(result.controls.composerContain, "none");
  assert.equal(result.controls.nativePermissionUntouched, true);
  assert.equal(result.controls.hostOutsideFooter, true);
  assert.equal(result.controls.detachedHostHiddenAttribute, false,
    "the test must observe the gap before an imperative repair runs");
  assert.equal(result.controls.detachedHostDisplay, "none",
    "the custom host must not paint without a live native composer anchor");
  assert.deepEqual(result.controls.detachedHostBounds,
    { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  assert.equal(result.controls.promptMenuReachable, true);
  assert.equal(result.controls.contextMenuReachable, true);
  const aligned = ({ host, permission }) => (
    Math.abs(host.left - permission.right - 5) < 0.6
    && Math.abs(host.top - permission.top) < 0.6
    && host.width > 1 && host.height > 1
  );
  assert.equal(aligned(result.controls.initialBounds), true, "initial controls are not anchored");
  assert.equal(aligned(result.controls.multilineBounds), true, "multiline controls are not anchored");
  assert.equal(aligned(result.controls.sessionBounds), true, "Session controls are not anchored");
  assert.notEqual(
    result.controls.initialBounds.host.top,
    result.controls.multilineBounds.host.top,
    "composer expansion did not move controls",
  );
  assert.equal(result.stress.navigationRepairs, 100);
  assert.ok(result.stress.navigationPeakTimers > 0 && result.stress.navigationPeakTimers <= 3);
  assert.equal(result.stress.navigationEndTimers, 0);
  assert.equal(result.stress.inputEnsureDelta, 0);
  assert.equal(result.stress.inputPositionDelta, 0);
  assert.ok(result.stress.graphAttempts <= 1);
  assert.deepEqual(result.stress.settledTimers,
    { managerProbe: 0, navigation: 0, toast: 0, bridge: 0 });
}

async function runFixture(filename, profileName, windowSize, virtualTimeMs = null) {
  const profile = path.join(runRoot, profileName);
  await fs.mkdir(profile, { recursive: true });
  return resultFromDump(await dumpDom(browser, chromeArgs({
    fixtureUrl: pathToFileURL(filename).href,
    profile,
    virtualTimeMs,
    windowSize,
  }), 30_000));
}

try {
  const [controlCss, loadedWallpaper] = await Promise.all([
    loadControlCss(projectRoot),
    loadWallpaperFixturePayload(projectRoot, { fault }),
  ]);
  const wallpaperFile = path.join(runRoot, "wallpaper.html");
  await fs.writeFile(wallpaperFile, wallpaperFixtureHtml({
    controlCss,
    wallpaperPayload: loadedWallpaper.payload,
  }), { mode: 0o600 });
  const large = await runFixture(wallpaperFile, "wallpaper-large", "1000,700");
  const resized = await runFixture(wallpaperFile, "wallpaper-resized", "820,520");
  assertWallpaper(large, 1000);
  assertWallpaper(resized, 820);
  assert.notEqual(large.states[0].viewport.height, resized.states[0].viewport.height);

  const contextPayload = await makePayload({
    features: { prompt: true, context: true },
    contexts: [
      { id: "native", label: "Native / Official", native: true },
      { id: "oai", label: "Legacy OAI 272K", contextWindow: 272000,
        autoCompactTokenLimit: 244800, scope: "total" },
      { id: "400k", label: "400K", contextWindow: 400000,
        autoCompactTokenLimit: 360000, scope: "total" },
      { id: "450k", label: "450K", contextWindow: 450000,
        autoCompactTokenLimit: 400000, scope: "total" },
      { id: "600k", label: "600K", contextWindow: 600000,
        autoCompactTokenLimit: 540000, scope: "total" },
    ],
    defaultProfileId: "default",
    defaultContextId: "native",
  });
  try {
    const contextFile = path.join(runRoot, "context.html");
    await fs.writeFile(contextFile, contextBrowserFixture(contextPayload.loaded.payload), {
      mode: 0o600,
    });
    const context = await runFixture(contextFile, "context", "1000,700", 10_000);
    const resizedContext = await runFixture(
      contextFile,
      "context-resized",
      "820,520",
      10_000,
    );
    assertContext(context, 1000);
    assertContext(resizedContext, 820);
    report = {
      schema: "codexctl-browser-regression/1",
      browser: path.basename(browser),
      status: "pass",
      cases: [
        "WALLPAPER-FIRST-VISIBLE-001",
        "WALLPAPER-BOTTOM-COVERAGE-002",
        "WALLPAPER-THEME-SEMANTICS-003",
        "WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001",
        "WALLPAPER-ZERO-HOTPATH-004",
        "PROMPT-CONTEXT-ANCHOR-001",
        "PROMPT-DEFAULT-THREAD-002",
        "PROMPT-NEXT-BASE-003",
        "CONTEXT-COPY-SEMANTICS-001",
        "PROMPT-CONTEXT-NAVIGATION-PERF-004",
        "CONTEXT-NATIVE-NO-OVERRIDE-002",
        "CONTEXT-IDLE-MONOTONIC-003",
        "CONTEXT-ACTIVE-SAFE-BOUNDARY-004",
        "CONTEXT-QUEUE-COALESCE-005",
        "CONTEXT-SHRINK-REJECT-006",
        "CONTEXT-NATIVE-COMPARABLE-007",
        "CONTEXT-NATIVE-UNKNOWN-008",
        "CONTEXT-IDEMPOTENT-009",
        "CONTEXT-WINDOW-MAPPING-010",
        "CONTEXT-PENDING-FRESH-USAGE-011",
      ].map((id) => ({ id, status: "pass" })),
      metrics: {
        largeViewport: large.states[0].viewport,
        resizedViewport: resized.states[0].viewport,
        wallpaperStress: large.stressDelta,
        promptContextStress: context.stress,
      },
    };
  } finally {
    await fs.rm(contextPayload.directory, { force: true, recursive: true });
  }
} finally {
  await fs.rm(runRoot, { force: true, recursive: true });
}

await assert.rejects(fs.access(runRoot), (error) => error.code === "ENOENT");
report.cleanup = { profileRemoved: true, processExited: true };
if (selectedCase) {
  report.cases = report.cases.filter(({ id }) => id === selectedCase);
  if (report.cases.length !== 1) throw new Error(`Browser case has no implementation: ${selectedCase}`);
}
if (json) console.log(JSON.stringify(report));
else console.log(`browser regression passed: ${report.browser}, ${report.cases.length} L3 cases`);
