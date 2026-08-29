import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { materializeRuntime } from "../src/runtime.mjs";
import { installOnce } from "../src/one-shot-injection.mjs";
import {
  descendantProcessRows,
  listProcessRows,
  readProcessRow,
} from "../src/desktop-processes.mjs";
import { assertSafeProfile } from "./ownership.mjs";
import { launchElectronFixture } from "./electron-runtime.mjs";
import { exerciseAppInteractions } from "./app-interactions.mjs";
import { runRendererBenchmark } from "./renderer-benchmark.mjs";
import {
  captureRedactedScreenshot,
  markWallpaperVisible,
  probeControls,
  probeDiagnostics,
  probeInstallationDetails,
  probeMetrics,
  probeRemote,
  probeVisual,
  waitForInjectedModules,
  withAppSession,
} from "./app-cdp.mjs";

const MODULE_NAMES = Object.freeze(["context", "prompt", "wallpaper"]);
const DEFAULT_MODULES = Object.freeze({ context: true, prompt: true, wallpaper: true });

export function normalizeFixtureModules(value = DEFAULT_MODULES) {
  const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
  if (keys.length !== MODULE_NAMES.length
    || keys.some((key, index) => key !== MODULE_NAMES[index])
    || MODULE_NAMES.some((name) => typeof value[name] !== "boolean")) {
    throw new Error("Fixture modules require exact booleans");
  }
  return Object.freeze(Object.fromEntries(MODULE_NAMES.map((name) => [name, value[name]])));
}

async function fixtureRuntime(envelope, modules) {
  const prompt = path.join(envelope.runtime, "developer-prompt.md");
  await fs.writeFile(prompt, "synthetic regression developer prompt\n", { mode: 0o600 });
  const config = createDefaultConfig();
  config.modules = normalizeFixtureModules(modules);
  config.prompt.profiles = [{ id: "work", label: "Work", path: prompt }];
  config.context.presets.push({
    id: "600k", label: "600K", contextWindow: 600000,
    autoCompactTokenLimit: 540000, scope: "total",
  });
  const paths = resolvePaths({
    HOME: envelope.root,
    CODEXCTL_HOME: path.join(envelope.runtime, "controller"),
  });
  return { config, paths, runtime: await materializeRuntime(config, paths) };
}

async function applyFault(port, fault) {
  if (!fault) return;
  await withAppSession(port, (session) => session.evaluate(({
    anchor: `(() => {
      const style = document.createElement("style");
      style.id = "fixture-anchor-fault";
      style.textContent = "#codex-prompt-context-control-host{position:fixed!important;left:0!important;top:0!important}";
      document.head.append(style);
    })()`,
    "bottom-black": `(() => {
      document.getElementById("bottom")?.style.setProperty(
        "background", "rgb(17,17,17)", "important"
      );
    })()`,
    "control-duplicate": `(() => {
      const button = document.querySelector('[data-codex-base-prompt-trigger="true"]');
      if (button) button.parentElement.append(button.cloneNode(true));
    })()`,
    remote: `window.__CODEXCTL_REGRESSION_APP__.remote = {
      errors: ["websocket-reset"], status: "disconnected"
    }`,
    "sidebar-overlap": `(() => {
      const style = document.createElement("style");
      style.id = "fixture-sidebar-fault";
      style.textContent = "#sidebar{position:absolute!important;z-index:2}#main{margin-left:0!important}";
      document.head.append(style);
    })()`,
    "wallpaper-late": `window.__CODEXCTL_REGRESSION_APP__.wallpaperVisibleMs = 751`,
  })[fault] ?? "undefined"));
}

export function cpuSummaryMetrics(cpu) {
  return {
    cpuMedian: cpu?.idle?.summary?.total?.p50 ?? 0,
    cpuP95: cpu?.idle?.summary?.total?.p95 ?? 0,
  };
}

export function createElectronAppAdapter({
  artifactDir = null,
  artifactLabel = null,
  benchmarkOptions = null,
  cleanupFault = false,
  cpuProbe = null,
  electron = null,
  envelope,
  exerciseInteractions = false,
  fault = null,
  fixtureDeadlineMs = 60_000,
  mode,
  modules,
  platform = process.platform === "darwin" ? "macos" : "linux",
  viewport = { height: 700, width: 1000 },
} = {}) {
  if (!new Set(["official", "injected"]).has(mode)) throw new Error(`Invalid App mode: ${mode}`);
  const fixtureModules = normalizeFixtureModules(modules);
  const screenshotLabel = artifactLabel ?? mode;
  if (!/^[a-z0-9-]{1,60}$/.test(screenshotLabel)) throw new Error("Invalid App artifact label");
  let fixture = null;
  let screenshot = null;
  let injection = null;
  let details = null;
  let interactions = null;
  let benchmark = null;
  let cpu = null;
  let launchDurationMs = null;
  const adapter = {
    platform,
    get injection() { return injection; },
    get interactions() { return interactions; },
    get benchmark() { return benchmark; },
    get cpu() { return cpu; },
    get launchDurationMs() { return launchDurationMs; },
    get details() { return details; },
    get screenshot() { return screenshot; },
    async preflight() {
      assertSafeProfile(envelope.profile, { envelope });
      return { reasonCodes: [], status: "pass" };
    },
    async launch() {
      const launchStartedAt = performance.now();
      fixture = await launchElectronFixture({
        deadlineMs: fixtureDeadlineMs,
        electron, envelope, height: viewport.height, width: viewport.width,
      });
      const row = envelope.processes.get(fixture.ready.pid);
      if (mode === "injected") {
        const prepared = await fixtureRuntime(envelope, fixtureModules);
        const startedAt = performance.now();
        injection = await installOnce(
          prepared.paths,
          prepared.config,
          prepared.runtime,
          fixture.port,
        );
        await waitForInjectedModules(fixture.port, fixtureModules);
        if (fixtureModules.wallpaper) {
          await markWallpaperVisible(fixture.port, performance.now() - startedAt);
        }
      }
      await applyFault(fixture.port, fault);
      launchDurationMs = performance.now() - launchStartedAt;
      return {
        appVersion: fixture.ready.appVersion,
        cliVersion: "fixture-cli-1",
        executableId: "ElectronRegression",
        pid: fixture.ready.pid,
        profileId: envelope.runId,
        startedAt: row.startedAt,
      };
    },
    async remote() { return probeRemote(fixture.port); },
    async processTree() {
      const rows = await listProcessRows();
      const family = descendantProcessRows(rows, fixture.ready.pid);
      const familyPids = new Set(family.map(({ pid }) => pid));
      const appServerAlive = familyPids.has(fixture.ready.appServerPid)
        && Boolean(await readProcessRow(fixture.ready.appServerPid));
      const controllerCount = rows.filter(({ command }) => (
        command.includes(envelope.root) && /(?:prompt-context|wallpaper-lite)[\\/]injector\.mjs/.test(command)
      )).length;
      return {
        appServerCount: appServerAlive ? 1 : 0,
        controllerCount,
        duplicatePresence: false,
        processCount: family.length + 1,
      };
    },
    async visual() {
      const result = await probeVisual(fixture.port);
      if (artifactDir && !screenshot) {
        screenshot = await captureRedactedScreenshot(
          fixture.port,
          path.join(artifactDir, `${screenshotLabel}-fixture.png`),
        );
      }
      return result;
    },
    async controls() {
      const result = await probeControls(fixture.port);
      if (exerciseInteractions && mode === "injected") {
        interactions = await exerciseAppInteractions(fixture.port);
      }
      return result;
    },
    async metrics() {
      if (benchmarkOptions) {
        benchmark = await runRendererBenchmark({ port: fixture.port, ...benchmarkOptions });
      }
      if (cpuProbe) {
        cpu = await cpuProbe({
          appServerPid: fixture.ready.appServerPid,
          pid: fixture.ready.pid,
          port: fixture.port,
        });
      }
      const result = await probeMetrics(fixture.port);
      const measured = benchmark ? {
        ...result,
        inputMaxMs: benchmark.input.maxMs,
        inputP95Ms: benchmark.input.p95Ms,
        longTaskCount: benchmark.longTasks.samples,
        scrollMaxMs: benchmark.scroll.maxMs ?? 0,
        scrollP95Ms: benchmark.scroll.p95Ms ?? 0,
      } : result;
      if (!cpu) return measured;
      return {
        ...measured,
        ...cpuSummaryMetrics(cpu),
      };
    },
    async diagnostics() {
      const [diagnostics, installation] = await Promise.all([
        probeDiagnostics(fixture.port),
        probeInstallationDetails(fixture.port),
      ]);
      details = installation;
      return diagnostics;
    },
    async cleanup() {
      const result = fixture ? await fixture.close() : { orphans: [], status: "pass" };
      if (!cleanupFault) return result;
      return {
        orphans: [{ kind: "fixture", pid: fixture?.ready.pid ?? 2 }],
        status: "fail",
      };
    },
  };
  return adapter;
}
