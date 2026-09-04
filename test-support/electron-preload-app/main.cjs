"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, protocol } = require("electron");

const [readyFile, ackFile] = process.argv.slice(-3, -1);
if (![readyFile, ackFile].every((value) => path.isAbsolute(value || ""))) {
  throw new Error("fixture control paths must be absolute");
}

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}]);

let watcher = null;
let deadline = null;
function cleanup() {
  watcher?.close();
  watcher = null;
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
}

app.on("will-quit", cleanup);
app.whenReady().then(async () => {
  protocol.handle("app", () => new Response(
    "<!doctype html><html><body><main id=app>preload fixture</main></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8" } },
  ));
  watcher = fs.watch(path.dirname(ackFile), () => {
    if (!fs.existsSync(ackFile)) return;
    cleanup();
    app.quit();
  });
  deadline = setTimeout(() => {
    cleanup();
    app.exit(2);
  }, 25_000);
  fs.writeFileSync(readyFile, `${JSON.stringify({
    electron: process.versions.electron,
    pid: process.pid,
  })}\n`, { mode: 0o600 });
  const window = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  await window.loadURL("app://-/first");
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
