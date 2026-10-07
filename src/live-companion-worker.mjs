#!/usr/bin/env node

import { readLiveBootstrap } from "./live-bootstrap.mjs";
import { pairLiveCompanion } from "./live-companion.mjs";
import { prepareLiveCompanion } from "./live-prepare.mjs";
import { liveCodeRevision } from "./live-code.mjs";
import { loadConfig } from "./config.mjs";
import { resolvePaths } from "./paths.mjs";

function report(value) {
  if (typeof process.send === "function" && process.connected) process.send({
    schema: "codexctl-live-worker-event/1",
    ...value,
  });
}

function waitForLaunch(bootstrap, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.removeListener("message", receive);
      reject(new Error("live App launch identity timed out"));
    }, timeoutMs);
    const receive = (value) => {
      if (!value || value.schema !== "codexctl-live-worker-launch/1"
        || value.sessionId !== bootstrap.sessionId
        || !Number.isSafeInteger(value.appPid) || value.appPid < 2
        || value.debugPort !== bootstrap.debugPort) return;
      clearTimeout(timer);
      process.removeListener("message", receive);
      resolve(value);
    };
    process.on("message", receive);
  });
}

async function main() {
  let paired = false;
  process.once("disconnect", () => {
    if (!paired) process.kill(process.pid, "SIGTERM");
  });
  const bootstrapFile = process.env.CODEXCTL_LIVE_BOOTSTRAP;
  delete process.env.CODEXCTL_LIVE_BOOTSTRAP;
  const preparation = new Promise((resolve) => {
    const receive = (value) => {
      if (value?.schema !== "codexctl-live-worker-prepare/1") return;
      process.removeListener("message", receive);
      resolve(value.checkpoint);
    };
    process.on("message", receive);
  });
  report({ phase: "booted" });
  const checkpoint = await preparation;
  const bootstrap = await readLiveBootstrap(bootstrapFile);
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: bootstrap.controllerHome });
  bootstrap.hostRevision = await liveCodeRevision(paths);
  const config = await loadConfig(paths);
  const prepared = await prepareLiveCompanion(paths, config, bootstrap, checkpoint);
  if (await liveCodeRevision(paths) !== bootstrap.hostRevision) {
    throw new Error("live code changed during preparation; previous companion remains active");
  }
  const launched = waitForLaunch(bootstrap);
  report({
    catalogRevision: prepared.catalog.revision,
    hostRevision: bootstrap.hostRevision,
    phase: "ready",
    sessionId: bootstrap.sessionId,
  });
  const launch = await launched;
  const live = await pairLiveCompanion({
    appPid: launch.appPid,
    bootstrap,
    paths,
    prepared,
  });
  report({
    appPid: live.app.pid,
    companionPid: process.pid,
    hostRevision: bootstrap.hostRevision,
    phase: "paired",
    sessionId: bootstrap.sessionId,
  });
  paired = true;
  if (process.connected) process.disconnect();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void live.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await live.closed;
}

main().catch((error) => {
  report({
    code: String(error.code ?? "companion-failed").slice(0, 80),
    message: String(error.message ?? error).slice(0, 600),
    phase: "error",
  });
  process.exitCode = 1;
});
