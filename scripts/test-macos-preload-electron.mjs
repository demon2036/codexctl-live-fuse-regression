import fs from "node:fs/promises";
import { watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { waitForMacPreloadResult } from "../src/macos-preload-runtime.mjs";
import { discoverTestElectron } from "../regression/electron-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "test-support", "electron-preload-app");
const HOOK = path.join(ROOT, "src", "macos-preload.cjs");
const CASE_ID = "INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002";

function waitForJson(filename, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const directory = path.dirname(filename);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      watcher.close();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const read = async () => {
      try { finish(null, JSON.parse(await fs.readFile(filename, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") finish(error); }
    };
    const watcher = watch(directory, read);
    const timer = setTimeout(() => finish(new Error("Electron fixture readiness timed out")), timeoutMs);
    void read();
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error("Electron fixture did not exit")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function promptPayload(revision) {
  return `(() => {
    if (location.pathname === "/first") {
      setTimeout(() => { location.href = "app://-/second"; }, 0);
      return new Promise(() => {});
    }
    const diagnostics = {
      revision: ${JSON.stringify(revision)}, features: { prompt: true, context: true },
      appRoutesReady: true,
      managerStatus: "ready", managerProbe: { attempts: 1, inProgress: false },
      buttonCount: 1, contextButtonCount: 1, providerIndicatorCount: 1,
      promptButtons: [{ visible: true }], contextButtons: [{ visible: true }],
      providerIndicators: [{ visible: true }],
      currentProvider: { id: "polo", status: "resolved" },
      activeTimers: { managerProbe: 0, navigation: 0, toast: 0, bridge: 0 },
      uiMetrics: { navigationRepairs: 0, mutationBatches: 0, mutationRecords: 0 }
    };
    window.__CODEX_BASE_PROMPT_SWITCHER__ = { diagnostics: () => diagnostics };
  })()`;
}

function wallpaperPayload(revision) {
  return `(() => {
    const art = "blob:codexctl-pending";
    const diagnostics = {
      revision: ${JSON.stringify(revision)}, themeId: "fixture", installed: true,
      artReady: art.startsWith("blob:"), stylePresent: true, rootAttribute: "on",
      metrics: { observers: 0, timers: 0, cssBytes: 1, styleRules: 1 }
    };
    window.__CODEXCTL_WALLPAPER_V2__ = { diagnostics: () => diagnostics };
  })()`;
}

async function main() {
  if (process.platform !== "darwin") {
    console.log(JSON.stringify({
      caseId: "INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002",
      platformApplicable: false,
      status: "pass",
    }));
    return;
  }
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-electron-"));
  const runtimeDir = path.join(runRoot, "runtime");
  const readyFile = path.join(runRoot, "ready.json");
  const ackFile = path.join(runRoot, "ack");
  const resultFile = path.join(runtimeDir, `preload-result-${randomUUID()}.json`);
  const specFile = path.join(runtimeDir, "macos-preload.json");
  const promptRevision = "a".repeat(24);
  const wallpaperRevision = "b".repeat(24);
  let child = null;
  let stderr = "";
  try {
    await fs.mkdir(path.join(runtimeDir, "theme"), { recursive: true, mode: 0o700 });
    const art = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await fs.writeFile(path.join(runtimeDir, "theme", "fixture.png"), art, { mode: 0o600 });
    await fs.writeFile(specFile, `${JSON.stringify({
      schema: "codexctl-macos-preload/1",
      promptContext: { payload: promptPayload(promptRevision), revision: promptRevision },
      wallpaper: {
        bytes: art.length,
        image: "theme/fixture.png",
        mime: "image/png",
        payload: wallpaperPayload(wallpaperRevision),
        revision: wallpaperRevision,
        themeId: "fixture",
      },
    })}\n`, { mode: 0o600 });
    const electron = await discoverTestElectron();
    child = spawn(electron, [FIXTURE, readyFile, ackFile, resultFile], {
      env: {
        ...process.env,
        CODEXCTL_PRELOAD_RESULT: resultFile,
        CODEXCTL_PRELOAD_SPEC: specFile,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        NODE_OPTIONS: `--require=${HOOK}`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2_000); });
    const ready = await waitForJson(readyFile, 10_000);
    if (ready.pid !== child.pid) throw new Error("Electron ready PID did not match owned child");
    const injection = await waitForMacPreloadResult(resultFile, child.pid, {
      modules: { prompt: true, context: true, wallpaper: true },
      promptContext: { revision: promptRevision },
      wallpaper: { revision: wallpaperRevision },
    });
    await fs.writeFile(ackFile, "ok\n", { mode: 0o600 });
    const exitCode = await waitForExit(child, 5_000);
    if (exitCode !== 0) throw new Error(`Electron fixture exited ${exitCode}`);
    process.stdout.write(`${JSON.stringify({
      caseId: CASE_ID,
      durationMs: injection.durationMs,
      electron: ready.electron,
      navigatedUrl: injection.url.endsWith("/second"),
      prompt: injection.promptContext.buttonCount === 1,
      context: injection.promptContext.contextButtonCount === 1,
      provider: injection.promptContext.providerIndicatorCount === 1,
      wallpaper: injection.wallpaper.installed === true,
      status: "pass",
    }, null, 2)}\n`);
  } catch (error) {
    const detail = `${error.message}${stderr ? `; Electron: ${stderr}` : ""}`
      .replaceAll(runRoot, "<run>");
    throw new Error(detail);
  } finally {
    if (child?.exitCode === null) {
      await fs.writeFile(ackFile, "cleanup\n", { mode: 0o600 }).catch(() => {});
      await waitForExit(child, 2_000).catch(() => child.kill("SIGTERM"));
    }
    await fs.rm(runRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
