import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { discoverDesktop, planAppLaunch } from "../src/platform.mjs";
import { parseRelayOverrides } from "../src/relay.mjs";

test("Linux launch uses the same injection flags and keeps relay ephemeral", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  const cli = path.join(directory, "codex");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.cliPath = cli;
  config.app.debugPort = 19342;
  config.modules.context = true;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const relay = parseRelayOverrides([
    "url=https://relay.example/v1",
    "key=test-only",
    "proxy=http://127.0.0.1:10808",
  ]);
  const plan = await planAppLaunch(config, paths, relay, { inject: true }, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "linux");
  assert.equal(plan.executable, await fs.realpath(app));
  assert.ok(plan.argv.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(plan.argv.includes("--remote-debugging-port=19342"));
  assert.equal(plan.environment.CODEX_CLI_PATH, paths.bridgeExecutable);
  assert.equal(plan.environment.CODEX_APP_BASE_URL, "https://relay.example/v1");
  assert.equal(plan.environment.CODEX_APP_API_KEY, "test-only");
  assert.ok(plan.argv.includes("--proxy-server=http://127.0.0.1:10808"));
});

test("[PLATFORM-LINUX-WORKSPACE-ROUTE-004] Linux project route is not overwritten by fallback", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-route-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    extraArgs: ["--open-project", directory],
  }, { HOME: directory, PATH: "/usr/bin:/bin" }, "linux");
  assert.ok(plan.argv.includes("--open-project"));
  assert.equal(plan.argv.includes("codex://launch"), false);
});

test("macOS official mode exactly matches an icon launch", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-mac-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, "ChatGPT.app");
  const app = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  const pathCli = path.join(directory, "bin", "codex");
  await fs.mkdir(path.dirname(app), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.mkdir(path.dirname(pathCli), { recursive: true });
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(pathCli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = bundle;
  config.app.cliPath = pathCli;
  config.modules.context = true;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });

  const official = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    inject: false,
    officialCliSource: "embedded",
  }, { HOME: directory, PATH: `${path.dirname(pathCli)}:/usr/bin:/bin` }, "darwin");
  assert.equal(official.launchMethod, "launch-services");
  assert.deepEqual(official.argv, []);
  assert.equal(official.injectionEnabled, false);
  assert.equal(official.desktop.officialCli, cli);
  assert.equal(official.environment.CODEX_CLI_PATH, cli);
  assert.notEqual(official.environment.CODEX_CLI_PATH, await fs.realpath(pathCli));

  const injected = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    inject: true,
    officialCliSource: "embedded",
    preloadSpecFile: path.join(directory, "runtime", "macos-preload.json"),
  }, { HOME: directory, PATH: `${path.dirname(pathCli)}:/usr/bin:/bin` }, "darwin");
  assert.equal(injected.launchMethod, "launch-services");
  assert.equal(injected.injectionTransport, "electron-preload");
  assert.deepEqual(injected.argv, []);
  assert.equal(injected.argv.includes("codex://launch"), false);
  assert.equal(injected.argv.some((value) => value.startsWith("--remote-debugging-port=")), false);
  assert.equal(injected.environment.CODEX_CLI_PATH, cli);
  assert.notEqual(injected.environment.CODEX_CLI_PATH, await fs.realpath(pathCli));
  assert.match(injected.environment.NODE_OPTIONS, /macos-preload\.cjs/);
  assert.equal(injected.environment.CODEXCTL_PRELOAD_SPEC,
    path.join(directory, "runtime", "macos-preload.json"));
  assert.match(injected.environment.CODEXCTL_PRELOAD_RESULT, /preload-result-[a-f0-9-]{36}\.json$/);
});

test("Remote-safe launch rejects a PATH CLI source instead of version-skewing the App", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-cli-source-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, "ChatGPT.app");
  const app = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  await fs.mkdir(path.dirname(app), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });

  await assert.rejects(() => planAppLaunch(config, paths, { enabled: false, values: {} }, {
    officialCliSource: "path",
  }, { HOME: directory, PATH: "/usr/bin:/bin" }, "darwin"), /App 内置 codex CLI/);
});

test("Linux native Wayland preference is preserved in a managed launch", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-wayland-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.linuxDisplay = "wayland";
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "linux");
  assert.ok(plan.argv.includes("--ozone-platform=wayland"));
});

test("Linux XWayland preference emits the explicit x11 Ozone backend", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-xwayland-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.linuxDisplay = "xwayland";
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "linux");
  assert.ok(plan.argv.includes("--ozone-platform=x11"));
});

test("Linux package discovery resolves the stable ChatGPT binary behind its launcher", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-linux-package-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binDirectory = path.join(directory, "bin");
  const packageDirectory = path.join(directory, "lib", "chatgpt");
  const resourcesDirectory = path.join(packageDirectory, "resources");
  await fs.mkdir(binDirectory, { recursive: true });
  await fs.mkdir(resourcesDirectory, { recursive: true });
  const launcher = path.join(packageDirectory, "codex-launcher");
  const app = path.join(packageDirectory, "ChatGPT");
  const cli = path.join(resourcesDirectory, "codex");
  for (const filename of [launcher, app, cli]) {
    await fs.writeFile(filename, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  await fs.symlink(launcher, path.join(binDirectory, "chatgpt"));
  const desktop = await discoverDesktop(createDefaultConfig(), {
    HOME: directory,
    PATH: binDirectory,
  }, "linux");
  assert.equal(desktop.executable, await fs.realpath(app));
  assert.equal(desktop.officialCli, await fs.realpath(cli));
});

test("official launch explicitly avoids an inherited old bridge", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-official-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  const cli = path.join(directory, "codex");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.cliPath = cli;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: "/stale/bridge",
    CODEX_APP_BASE_URL: "https://stale.invalid",
    CODEX_APP_API_KEY: "stale-secret",
  }, "linux");
  assert.equal(plan.environment.CODEX_CLI_PATH, cli);
  assert.equal(plan.environment.CODEX_APP_BASE_URL, undefined);
  assert.equal(plan.environment.CODEX_APP_API_KEY, undefined);
});

test("isolated launch sets the early Electron profile environment and Chromium argument", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-isolated-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "chatgpt");
  const profile = path.join(directory, "profile");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.modules.context = true;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    isolatedProfile: profile,
  }, { HOME: directory, PATH: "/usr/bin:/bin" }, "linux");
  assert.equal(plan.environment.CODEX_ELECTRON_USER_DATA_PATH, profile);
  assert.ok(plan.argv.includes(`--user-data-dir=${profile}`));
});
