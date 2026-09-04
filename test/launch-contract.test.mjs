import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { discoverDesktop, launchServicesArguments, planAppLaunch } from "../src/platform.mjs";
import { resolvePaths } from "../src/paths.mjs";

async function macBundle(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-launch-contract-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { bundle, cli, directory };
}

test("[LAUNCH-OFFICIAL-ICON-EQUIVALENCE-001] macOS official plan is zero-argument LaunchServices", async (t) => {
  const { bundle, cli, directory } = await macBundle(t);
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/tmp/wrong-cli:/usr/bin:/bin",
    NODE_OPTIONS: "--require=/tmp/stale-hook.cjs",
    CODEXCTL_PRELOAD_SPEC: "/tmp/stale-spec.json",
    CODEXCTL_PRELOAD_RESULT: "/tmp/stale-result.json",
  }, "darwin");
  assert.equal(plan.launchMethod, "launch-services");
  assert.deepEqual(plan.argv, []);
  assert.equal(plan.desktop.officialCli, cli);
  assert.equal(plan.environment.CODEX_CLI_PATH, cli);
  assert.equal(plan.environment.NODE_OPTIONS, undefined);
  assert.equal(plan.environment.CODEXCTL_PRELOAD_SPEC, undefined);
  assert.equal(plan.environment.CODEXCTL_PRELOAD_RESULT, undefined);
  assert.equal(JSON.stringify(plan).includes("remote-debugging"), false);
  const openArgs = launchServicesArguments(plan);
  assert.deepEqual(openArgs.slice(-1), [bundle]);
  assert.equal(openArgs.includes("--args"), false);
  assert.ok(openArgs.includes(`CODEX_CLI_PATH=${cli}`));
});

test("macOS preload environment is explicit in the LaunchServices request", async (t) => {
  const { bundle, directory } = await macBundle(t);
  const config = createDefaultConfig();
  config.app.path = bundle;
  config.modules.context = true;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const spec = path.join(directory, "runtime", "macos-preload.json");
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    inject: true, preloadSpecFile: spec,
  }, { HOME: directory, PATH: "/usr/bin:/bin" }, "darwin");
  const openArgs = launchServicesArguments(plan);
  assert.equal(openArgs.includes("--args"), false);
  assert.ok(openArgs.includes(`CODEXCTL_PRELOAD_SPEC=${spec}`));
  assert.ok(openArgs.some((value) => value.startsWith("CODEXCTL_PRELOAD_RESULT=")));
  assert.ok(openArgs.some((value) => value.startsWith("NODE_OPTIONS=--require=")));
  assert.equal(openArgs.at(-1), bundle);
});

test("macOS OAuth proxy keeps preload injection on LaunchServices", async (t) => {
  const { bundle, directory } = await macBundle(t);
  const config = createDefaultConfig();
  config.app.path = bundle;
  config.modules.context = true;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const spec = path.join(directory, "runtime", "macos-preload.json");
  const proxyServer = "http://127.0.0.1:10808";
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    inject: true,
    preloadSpecFile: spec,
    proxyServer,
  }, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "darwin");

  assert.equal(plan.launchMethod, "launch-services");
  assert.equal(plan.injectionTransport, "electron-preload");
  assert.equal(plan.debugPort, 0);
  assert.deepEqual(plan.argv, [`--proxy-server=${proxyServer}`]);
  assert.equal(plan.argv.includes("codex://launch"), false);
  assert.equal(plan.argv.some((value) => value.startsWith("--remote-debugging")), false);
  for (const key of [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
  ]) assert.equal(plan.environment[key], proxyServer);
  assert.equal(plan.environment.NO_PROXY, "localhost,127.0.0.1,::1");
  assert.equal(plan.environment.no_proxy, "localhost,127.0.0.1,::1");

  const openArgs = launchServicesArguments(plan);
  const bundleIndex = openArgs.indexOf(bundle);
  assert.ok(bundleIndex > 0);
  assert.deepEqual(openArgs.slice(bundleIndex), [
    bundle,
    "--args",
    `--proxy-server=${proxyServer}`,
  ]);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]) {
    assert.ok(openArgs.includes(`${key}=${plan.environment[key]}`));
  }
});

test("[PLATFORM-LINUX-LOOPBACK-002] Linux discovers ChatGPT and Codex desktop package names", async (t) => {
  for (const { launcherName, executableName } of [
    { launcherName: "chatgpt", executableName: "ChatGPT" },
    { launcherName: "codex-desktop", executableName: "Codex" },
  ]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-name-"));
    t.after(() => fs.rm(directory, { force: true, recursive: true }));
    const bin = path.join(directory, "bin");
    const application = path.join(directory, "lib", executableName);
    const launcher = path.join(directory, "lib", `${executableName}-launcher`);
    const cli = path.join(directory, "lib", "resources", "codex");
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(path.dirname(cli), { recursive: true });
    for (const filename of [application, launcher, cli]) {
      await fs.writeFile(filename, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    await fs.symlink(launcher, path.join(bin, launcherName));
    const desktop = await discoverDesktop(createDefaultConfig(), {
      HOME: directory,
      PATH: bin,
    }, "linux");
    assert.equal(desktop.executable, await fs.realpath(application));
    assert.equal(desktop.officialCli, await fs.realpath(cli));
  }
});
