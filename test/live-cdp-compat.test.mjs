import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { validateLiveBootstrap } from "../src/live-bootstrap.mjs";
import {
  LIVE_ACTION_BINDING,
  verifiedBrowserDebuggerUrl,
} from "../src/live-cdp-host.mjs";
import { planLiveAppLaunch } from "../src/live-platform.mjs";
import { launchServicesArguments } from "../src/platform.mjs";
import { resolvePaths } from "../src/paths.mjs";

async function macBundle(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-live-cdp-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { bundle, directory };
}

test("[LIVE-CDP-FUSE-001] live launch bypasses disabled NODE_OPTIONS through loopback CDP", async (t) => {
  const { bundle, directory } = await macBundle(t);
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const bootstrapFile = path.join(directory, "bootstrap.json");
  const plan = await planLiveAppLaunch(
    config,
    paths,
    { enabled: false, values: {} },
    bootstrapFile,
    {},
    { HOME: directory, PATH: "/usr/bin:/bin", NODE_OPTIONS: "--require=stale.cjs" },
    "darwin",
  );

  assert.equal(plan.launchMethod, "launch-services");
  assert.equal(plan.liveTransport, "cdp");
  assert.equal(plan.injectionTransport, "cdp-live");
  assert.equal(plan.environment.NODE_OPTIONS, undefined);
  assert.equal(plan.environment.CODEXCTL_LIVE_BOOTSTRAP, undefined);
  assert.ok(Number.isInteger(plan.debugPort) && plan.debugPort >= 1024);
  assert.ok(plan.argv.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(plan.argv.includes(`--remote-debugging-port=${plan.debugPort}`));
  const openArgs = launchServicesArguments(plan);
  assert.deepEqual(openArgs.slice(openArgs.indexOf(bundle)), [bundle, "--args", ...plan.argv]);
});

test("live proxy launch keeps OAuth proxy and CDP on separate transports", async (t) => {
  const { bundle, directory } = await macBundle(t);
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const proxy = "http://127.0.0.1:10808";
  const plan = await planLiveAppLaunch(
    config,
    paths,
    { enabled: false, values: {} },
    path.join(directory, "bootstrap.json"),
    { proxyServer: proxy },
    { HOME: directory, PATH: "/usr/bin:/bin" },
    "darwin",
  );
  assert.equal(plan.proxyServer, proxy);
  assert.equal(plan.environment.HTTP_PROXY, proxy);
  assert.ok(plan.argv.includes(`--proxy-server=${proxy}`));
  assert.ok(plan.argv.includes(`--remote-debugging-port=${plan.debugPort}`));
  assert.equal(plan.environment.NODE_OPTIONS, undefined);
});

test("live bootstrap binds the CDP transport and port", () => {
  const root = "/private/tmp/codexctl-live-bootstrap-test";
  const value = validateLiveBootstrap({
    authToken: "a".repeat(64),
    cliSocketPath: `${root}/cli.sock`,
    companionLogFile: `${root}/companion.log`,
    controllerHome: root,
    createdAt: "2026-09-04T00:00:00.000Z",
    debugPort: 19437,
    desktop: {
      bundle: "/Applications/ChatGPT.app",
      executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      identity: "bundle:/Applications/ChatGPT.app",
    },
    hostRevision: "b".repeat(24),
    hostSocketPath: `${root}/host.sock`,
    schema: "codexctl-live-bootstrap/1",
    sessionId: "11111111-2222-4333-8444-555555555555",
    transport: "cdp",
  });
  assert.equal(value.transport, "cdp");
  assert.equal(value.debugPort, 19437);
  assert.throws(() => validateLiveBootstrap({ ...value, debugPort: 80 }), /bootstrap is invalid/);
});

test("live CDP browser endpoint validation remains loopback-only", () => {
  const valid = "ws://127.0.0.1:19437/devtools/browser/abc-123";
  assert.equal(verifiedBrowserDebuggerUrl(valid, 19437), valid);
  assert.equal(verifiedBrowserDebuggerUrl(
    "ws://192.168.1.9:19437/devtools/browser/abc-123", 19437,
  ), null);
  assert.equal(verifiedBrowserDebuggerUrl(
    "ws://127.0.0.1:19438/devtools/browser/abc-123", 19437,
  ), null);
});

test("live renderer actions prefer the CDP binding and failed start never terminates Desktop", async () => {
  const [control, launch] = await Promise.all([
    fs.readFile(new URL("../vendor/prompt-context/renderer/48-live-control.part.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/live-launch.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(control, new RegExp(`window\\.${LIVE_ACTION_BINDING}`));
  assert.doesNotMatch(launch, /terminateDesktopProcess|terminateProfileCrashHandlers/);
  assert.match(launch, /保持运行，codexctl 未终止它/);
});
