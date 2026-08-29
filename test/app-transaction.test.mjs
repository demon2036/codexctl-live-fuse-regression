import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { launchManagedApp } from "../src/app-transaction.mjs";
import { cleanController } from "../src/clean.mjs";
import { loadConfig, saveConfig } from "../src/config.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import {
  listDesktopProcesses,
  profileCrashHandlerMatches,
  readProcessRow,
  terminateDesktopProcess,
} from "../src/desktop-processes.mjs";
import { resolvePaths, PROJECT_ROOT } from "../src/paths.mjs";
import { recordManagedLaunch, waitForDesktopProcess } from "../src/launches.mjs";

const execFileAsync = promisify(execFile);

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-app-transaction-"));
  const directory = await fs.realpath(temporary);
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = process.platform === "darwin"
    ? path.join(bundle, "Contents", "MacOS", "ChatGPT")
    : path.join(directory, "fake-desktop");
  const cli = process.platform === "darwin"
    ? path.join(bundle, "Contents", "Resources", "codex")
    : path.join(directory, "fake-codex");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  try {
    await execFileAsync("/usr/bin/cc", [
      path.join(PROJECT_ROOT, "test", "fixtures", "fake-desktop.c"),
      "-O2",
      "-o",
      executable,
    ]);
  } catch (error) {
    throw new Error(`C compiler fixture unavailable: ${error.message}`);
  }
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (process.platform === "darwin") {
    const bundleId = `com.openai.codexctl.fixture.${path.basename(directory).replaceAll("-", "")}`;
    await fs.writeFile(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ChatGPT</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>
`, { mode: 0o600 });
  }
  const log = path.join(directory, "desktop.log");
  const env = {
    ...process.env,
    HOME: directory,
    CODEXCTL_HOME: path.join(directory, "state"),
    CODEXCTL_FAKE_DESKTOP_LOG: log,
  };
  const paths = resolvePaths(env);
  const config = createDefaultConfig();
  config.app.path = process.platform === "darwin" ? bundle : executable;
  config.app.cliPath = cli;
  const desktop = { executable };
  t.after(async () => {
    for (const processInfo of await listDesktopProcesses(desktop).catch(() => [])) {
      const stopped = await terminateDesktopProcess(processInfo, desktop, 3000);
      if (!stopped && await readProcessRow(processInfo.pid)) {
        throw new Error(`fixture Desktop ${processInfo.pid} did not exit`);
      }
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, executable, log, env, paths, config, desktop };
}

async function waitForCount(desktop, count, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processes = await listDesktopProcesses(desktop);
    if (processes.length === count) return processes;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${count} fake Desktop processes`);
}

async function waitForChild(log, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const contents = await fs.readFile(log, "utf8").catch(() => "");
    const pid = Number(contents.match(/child pid=(\d+)/)?.[1]);
    const processInfo = Number.isSafeInteger(pid) ? await readProcessRow(pid) : null;
    if (/(?:^|\/)sleep 300$/.test(processInfo?.command ?? "")) return processInfo;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("fake Desktop child did not start");
}

test("transaction API rejects Provider and relay routing before discovery or replacement", async () => {
  const config = createDefaultConfig();
  config.modules.prompt = true;
  await assert.rejects(launchManagedApp({
    paths: {},
    config,
    relay: { enabled: false, values: {} },
    options: { inject: true, providerId: "https://provider.invalid/v1" },
    env: {},
    platform: "linux",
  }), /Provider ID/);
  await assert.rejects(launchManagedApp({
    paths: {},
    config,
    relay: {
      enabled: true,
      values: {
        url: "https://relay.example/v1",
        apiKey: "fixture-secret",
        keySource: "argument",
        proxy: null,
        websockets: true,
        standaloneWebSearch: false,
        noProxy: "localhost,127.0.0.1,::1",
      },
    },
    options: { inject: true, providerId: "polo" },
    env: {},
    platform: "linux",
  }), /Provider.*relay|relay.*Provider/);
});

test("isolated crash-handler matching requires the exact profile and app bundle", () => {
  const desktop = { executable: "/Applications/Codex.app/Contents/MacOS/ChatGPT" };
  const profile = "/private/tmp/codexctl-isolated/profile";
  const handler = "/Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/"
    + "Helpers/browser_crashpad_handler --monitor-self --database="
    + profile + "/Crashpad --annotation=prod=ChatGPT_Mac";
  assert.equal(profileCrashHandlerMatches(handler, profile, desktop), true);
  assert.equal(profileCrashHandlerMatches(
    handler.replace("/Applications/Codex.app", "/Applications/Other.app"),
    profile,
    desktop,
  ), false);
  assert.equal(profileCrashHandlerMatches(
    handler.replace(profile, "/private/tmp/someone-else/profile"),
    profile,
    desktop,
  ), false);
});

test("Desktop replacement drains descendants that outlive the old main process", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, log, desktop } = fixtureState;
  const original = spawn(executable, [], {
    env: { ...env, CODEXCTL_FAKE_DESKTOP_CHILD: "1" },
    stdio: "ignore",
  });
  const processInfo = await waitForDesktopProcess(desktop, original.pid, 4000);
  const child = await waitForChild(log);
  t.after(() => {
    try { process.kill(child.pid, "SIGKILL"); } catch {}
  });

  assert.equal(await terminateDesktopProcess(processInfo, desktop, 3000), true);
  assert.equal(await readProcessRow(original.pid), null);
  assert.equal(await readProcessRow(child.pid), null);
});

test("isolated launch leaves an already-open primary App untouched", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, paths, config, desktop, directory } = fixtureState;
  const original = spawn(executable, [], { env, stdio: "ignore" });
  await waitForCount(desktop, 1);

  const result = await launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: { isolatedProfile: path.join(directory, "isolated-profile") },
    env,
    platform: process.platform,
  });
  assert.equal(result.action, "launched");
  assert.notEqual(result.processInfo.pid, original.pid);
  const running = await waitForCount(desktop, 2);
  assert.ok(running.some((entry) => entry.pid === original.pid));
  assert.ok(running.some((entry) => entry.pid === result.processInfo.pid));
});

test("[TDD-FIXTURE-DRAIN-025] Remote-safe reuse drains its owned fixture", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, paths, config, desktop } = fixtureState;
  config.modules.context = true;
  const original = spawn(executable, [], { env, stdio: "ignore" });
  const processInfo = await waitForDesktopProcess(desktop, original.pid, 4000);

  const result = await launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: { inject: false },
    env,
    platform: process.platform,
  });
  assert.equal(result.action, "reused");
  assert.equal(result.processInfo.pid, processInfo.pid);
  assert.equal(result.runtime, null);
});

test("[INJECTION-ROLLBACK-OFFICIAL-004] failed isolated CDP verification cleans only the test App", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, paths, config, desktop, directory } = fixtureState;
  const original = spawn(executable, [], { env, stdio: "ignore" });
  await waitForCount(desktop, 1);
  config.modules.context = true;

  await assert.rejects(launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: {
      inject: true,
      isolatedProfile: path.join(directory, "isolated-failure"),
      cdpTimeoutMs: 250,
    },
    env,
    platform: process.platform,
  }), /未出现 Codex/);

  const running = await waitForCount(desktop, 1);
  assert.equal(running[0].pid, original.pid);
});

test("[INJECTION-ROLLBACK-OFFICIAL-004] failed primary replacement restores a clean official App", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, paths, config, desktop } = fixtureState;
  const original = spawn(executable, [], { env, stdio: "ignore" });
  await waitForCount(desktop, 1);
  config.modules.context = true;

  await assert.rejects(launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: { inject: true, preloadTimeoutMs: 250 },
    env,
    platform: process.platform,
  }), /已恢复干净官方 Codex/);

  const running = await waitForCount(desktop, 1);
  assert.notEqual(running[0].pid, original.pid);
  assert.equal(running[0].command.includes("--remote-debugging-port"), false);
});

test("clean replaces only a precisely recorded injected primary with pristine official", async (t) => {
  const fixtureState = await fixture(t);
  const { executable, env, paths, config, desktop } = fixtureState;
  config.modules.context = true;
  config.app.debugPort = 19344;
  await saveConfig(paths, config);
  const injected = spawn(executable, ["--remote-debugging-port=19344", "codex://launch"], {
    env,
    stdio: "ignore",
  });
  const processInfo = await waitForDesktopProcess(desktop, injected.pid, 4000);
  assert.ok(processInfo);
  await recordManagedLaunch(paths, {
    executable,
    injectionEnabled: true,
    debugPort: 19344,
  }, processInfo, { enabled: false, values: {} }, config);

  const cleaned = await cleanController(paths, { env, platform: process.platform });
  assert.deepEqual(cleaned.modules, { prompt: false, context: false, wallpaper: false });
  assert.equal((await loadConfig(paths)).app.debugPort, 0);
  const running = await waitForCount(desktop, 1);
  assert.notEqual(running[0].pid, injected.pid);
  assert.equal(running[0].command.includes("--remote-debugging-port"), false);
});
