"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { LiveHostRenderer } = require("./live-host-renderer.cjs");
const { startLiveHostServer } = require("./live-host-server.cjs");

const BOOTSTRAP_FILE = process.env.CODEXCTL_LIVE_BOOTSTRAP;
if (BOOTSTRAP_FILE) {
  delete process.env.CODEXCTL_LIVE_BOOTSTRAP;
  delete process.env.NODE_OPTIONS;
}

function hostRevision() {
  const hash = createHash("sha256");
  for (const name of [
    "live-cdp-host.mjs", "live-host.cjs", "live-host-control.cjs",
    "live-host-renderer.cjs", "live-host-server.cjs", "live-host-wallpaper.cjs",
    "renderer-injection.mjs",
  ]) hash.update(fs.readFileSync(path.join(__dirname, name)));
  return hash.digest("hex").slice(0, 24);
}

function readBootstrap(filename) {
  if (!path.isAbsolute(filename || "")) throw new Error("live host bootstrap path is invalid");
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size < 2 || before.size > 64 * 1024) {
      throw new Error("live host bootstrap file is invalid");
    }
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : before.uid;
    if (before.uid !== expectedUid
      || (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)) {
      throw new Error("live host bootstrap file is not private");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new Error("live host bootstrap changed while being read");
    }
    const value = JSON.parse(bytes.toString("utf8"));
    const revision = hostRevision();
    if (value?.schema !== "codexctl-live-bootstrap/1" || value.hostRevision !== revision
      || !/^[a-f0-9]{64}$/.test(String(value.authToken ?? ""))
      || !/^[0-9a-f-]{36}$/i.test(String(value.sessionId ?? ""))
      || !path.isAbsolute(String(value.hostSocketPath ?? ""))) {
      throw new Error("live host bootstrap identity is invalid");
    }
    return { ...value, hostRevision: revision };
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeOwnedBootstrap(filename, expected) {
  try {
    const current = readBootstrap(filename);
    if (current.sessionId === expected.sessionId && current.authToken === expected.authToken) {
      fs.unlinkSync(filename);
    }
  } catch {}
}

if (BOOTSTRAP_FILE && process.versions.electron && (!process.type || process.type === "browser")) {
  setImmediate(async () => {
    try {
      const electron = require("electron");
      const bootstrap = readBootstrap(BOOTSTRAP_FILE);
      const cleanupBootstrap = () => removeOwnedBootstrap(BOOTSTRAP_FILE, bootstrap);
      electron.app.once("will-quit", cleanupBootstrap);
      process.once("exit", cleanupBootstrap);
      const controller = new LiveHostRenderer(electron).start();
      global.__CODEXCTL_LIVE_HOST__ = await startLiveHostServer({
        authToken: bootstrap.authToken,
        controller,
        electron,
        hostRevision: bootstrap.hostRevision,
        sessionId: bootstrap.sessionId,
        socketPath: bootstrap.hostSocketPath,
      });
    } catch (error) {
      process.stderr.write(`codexctl live host failed: ${String(error.message || error).slice(0, 600)}\n`);
    }
  });
}

module.exports = { hostRevision, readBootstrap, removeOwnedBootstrap };
