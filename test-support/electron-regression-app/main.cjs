"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, protocol } = require("electron");

const fixtureDir = __dirname;
const configArg = process.argv.find((value) => value.startsWith("--fixture-config="));
const configFile = configArg?.slice("--fixture-config=".length);
if (!path.isAbsolute(configFile || "")) throw new Error("fixture config must be absolute");
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
for (const field of ["profile", "readyFile", "stopFile", "snapshotFile", "snapshotResultFile"]) {
  if (!path.isAbsolute(config[field] || "")) throw new Error(`${field} must be absolute`);
}

app.setPath("userData", config.profile);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("no-first-run");
protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}]);

let appServer = null;
let watcher = null;
let deadline = null;
let quitting = false;
let window = null;
let snapshotRunning = false;
function publishJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filename);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
function stopServer() {
  if (!appServer || appServer.exitCode !== null) return;
  try { appServer.kill("SIGTERM"); } catch {}
}
function cleanup() {
  watcher?.close();
  watcher = null;
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  stopServer();
}
function quit() {
  if (quitting) return;
  quitting = true;
  cleanup();
  app.quit();
}
async function writeSnapshot() {
  if (snapshotRunning || !window || !fs.existsSync(config.snapshotFile)) return;
  snapshotRunning = true;
  try {
    const renderer = await window.webContents.executeJavaScript(`(() => ({
      globals: {
        prompt: Boolean(window.__CODEX_BASE_PROMPT_SWITCHER__),
        wallpaper: Boolean(window.__CODEXCTL_WALLPAPER_V2__)
      },
      hostCount: document.querySelectorAll('#codex-prompt-context-control-host').length,
      promptStyleCount: document.querySelectorAll('#codex-base-prompt-switcher-style').length,
      remote: window.__CODEXCTL_REGRESSION_APP__?.remote ?? null,
      wallpaperStyleCount: document.querySelectorAll('#codexctl-wallpaper-v2-style').length,
      workerCount: window.__CODEXCTL_REGRESSION_APP__?.counters?.workers ?? -1
    }))()`);
    publishJson(config.snapshotResultFile, {
      cdp: process.argv.some((value) => value.startsWith("--remote-debugging-")),
      nodeOptions: Boolean(process.env.NODE_OPTIONS),
      preloadEnvironment: Boolean(process.env.CODEXCTL_PRELOAD_SPEC
        || process.env.CODEXCTL_PRELOAD_RESULT),
      renderer,
    });
    fs.rmSync(config.snapshotFile, { force: true });
  } finally {
    snapshotRunning = false;
  }
}

app.on("before-quit", cleanup);
app.on("window-all-closed", () => { if (quitting) app.quit(); });
app.whenReady().then(async () => {
  app.dock?.hide();
  protocol.handle("app", (request) => {
    const pathname = new URL(request.url).pathname;
    const filename = pathname === "/renderer.js" ? "renderer.js" : "index.html";
    const contentType = filename.endsWith(".js")
      ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    return new Response(fs.readFileSync(path.join(fixtureDir, filename)), {
      headers: { "content-type": contentType },
    });
  });
  appServer = spawn(process.execPath, [path.join(fixtureDir, "app-server.cjs"), "app-server"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "ignore",
  });
  appServer.once("error", (error) => {
    publishJson(config.readyFile, { error: error.message });
    app.exit(3);
  });
  window = new BrowserWindow({
    width: config.width || 1000,
    height: config.height || 700,
    show: config.showWindow === true,
    webPreferences: { backgroundThrottling: false, contextIsolation: false, sandbox: false },
  });
  await window.loadURL("app://-/index.html");
  publishJson(config.readyFile, {
    appServerPid: appServer.pid,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    pid: process.pid,
    url: window.webContents.getURL(),
  });
  watcher = fs.watch(path.dirname(config.stopFile), () => {
    if (fs.existsSync(config.stopFile)) quit();
    else void writeSnapshot();
  });
  deadline = setTimeout(() => app.exit(4), config.deadlineMs || 60_000);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  cleanup();
  app.exit(2);
});
