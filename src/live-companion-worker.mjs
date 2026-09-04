#!/usr/bin/env node

import { readLiveBootstrap } from "./live-bootstrap.mjs";
import { pairLiveCompanion, prepareLiveCompanion } from "./live-companion.mjs";
import { loadConfig } from "./config.mjs";
import { resolvePaths } from "./paths.mjs";

function report(value) {
  if (typeof process.send === "function" && process.connected) process.send({
    schema: "codexctl-live-worker-event/1",
    ...value,
  });
}

async function main() {
  let paired = false;
  process.once("disconnect", () => {
    if (!paired) process.kill(process.pid, "SIGTERM");
  });
  const bootstrapFile = process.env.CODEXCTL_LIVE_BOOTSTRAP;
  delete process.env.CODEXCTL_LIVE_BOOTSTRAP;
  const bootstrap = await readLiveBootstrap(bootstrapFile);
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: bootstrap.controllerHome });
  const config = await loadConfig(paths);
  const prepared = await prepareLiveCompanion(paths, config, bootstrap);
  report({
    catalogRevision: prepared.catalog.revision,
    phase: "ready",
    sessionId: bootstrap.sessionId,
  });
  const live = await pairLiveCompanion({ bootstrap, paths, prepared });
  report({
    appPid: live.app.pid,
    companionPid: process.pid,
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
