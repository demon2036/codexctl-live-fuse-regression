import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { launchManagedApp } from "../src/app-transaction.mjs";
import {
  detachedDesktopHelperRows,
  listDesktopProcesses,
  readProcessRow,
} from "../src/desktop-processes.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import { recordManagedLaunch, waitForDesktopProcess } from "../src/launches.mjs";
import { PROJECT_ROOT, resolvePaths } from "../src/paths.mjs";

const execFileAsync = promisify(execFile);

async function boundaryFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-process-boundary-"));
  const directory = await fs.realpath(temporary);
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = process.platform === "darwin"
    ? path.join(bundle, "Contents", "MacOS", "ChatGPT")
    : path.join(directory, "ChatGPT");
  const cli = process.platform === "darwin"
    ? path.join(bundle, "Contents", "Resources", "codex")
    : path.join(directory, "codex");
  const monitor = path.join(bundle, "Contents", "Resources", "native", "bare-modifier-monitor");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.mkdir(path.dirname(monitor), { recursive: true });
  await execFileAsync("/usr/bin/cc", [
    path.join(PROJECT_ROOT, "test", "fixtures", "fake-desktop.c"),
    "-O2",
    "-o",
    executable,
  ]);
  await fs.copyFile(executable, cli);
  await fs.copyFile(executable, monitor);
  await fs.chmod(cli, 0o755);
  await fs.chmod(monitor, 0o755);
  if (process.platform === "darwin") {
    const suffix = path.basename(directory).replaceAll("-", "");
    await fs.writeFile(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ChatGPT</string>
<key>CFBundleIdentifier</key><string>com.openai.codexctl.boundary.${suffix}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>
`);
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
  const desktop = { bundle: process.platform === "darwin" ? bundle : null, executable,
    officialCli: cli, platform: process.platform };
  const owned = new Set();
  t.after(async () => {
    for (const pid of owned) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    for (const row of await listDesktopProcesses(desktop).catch(() => [])) {
      try { process.kill(row.pid, "SIGKILL"); } catch {}
    }
    await fs.rm(directory, { force: true, recursive: true });
  });
  return { bundle, cli, config, desktop, directory, env, executable, log, monitor, owned, paths };
}

async function waitForLogPids(filename, labels, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await fs.readFile(filename, "utf8").catch(() => "");
    const pids = labels.map((label) => Number(text.match(new RegExp(`${label} pid=(\\d+)`))?.[1]));
    if (pids.every(Number.isSafeInteger)) return pids;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process fixture did not report ${labels.join(",")}`);
}

async function assertGone(pids) {
  for (const pid of pids) assert.equal(await readProcessRow(pid), null, `PID ${pid} remains`);
}

test("detached helper classifier includes duplicate bundled app-server", () => {
  const bundle = "/Applications/ChatGPT.app";
  const desktop = {
    bundle,
    executable: `${bundle}/Contents/MacOS/ChatGPT`,
    officialCli: `${bundle}/Contents/Resources/codex`,
  };
  const rows = [
    { pid: 10, ppid: 1, startedAt: "main", command: desktop.executable },
    { pid: 11, ppid: 10, startedAt: "owned", command: `${desktop.officialCli} app-server` },
    { pid: 12, ppid: 1, startedAt: "duplicate", command: `${desktop.officialCli} app-server` },
  ];
  assert.deepEqual(detachedDesktopHelperRows(rows, desktop).map(({ pid }) => pid), [12]);
});

test("[LAUNCH-DESCENDANT-DRAIN-003] replacement drains descendants and detached helpers before takeover", async (t) => {
  if (process.platform !== "darwin") {
    assert.equal(process.platform === "linux" || process.platform === "win32", true);
    return;
  }
  const fixture = await boundaryFixture(t);
  const { cli, config, desktop, env, executable, log, monitor, owned, paths } = fixture;
  const old = spawn(executable, [], {
    env: { ...env, CODEXCTL_FAKE_DESKTOP_CHILD: "2" },
    stdio: "ignore",
  });
  owned.add(old.pid);
  const oldInfo = await waitForDesktopProcess(desktop, old.pid, 4000);
  const descendants = await waitForLogPids(log, ["child", "grandchild"]);
  descendants.forEach((pid) => owned.add(pid));
  const appServer = spawn(cli, ["app-server"], { env, stdio: "ignore" });
  const modifier = spawn(monitor, [], { env, stdio: "ignore" });
  owned.add(appServer.pid);
  owned.add(modifier.pid);
  await Promise.all([
    waitForDesktopProcess({ executable: cli }, appServer.pid, 4000),
    waitForDesktopProcess({ executable: monitor }, modifier.pid, 4000),
  ]);
  config.modules.context = true;
  await recordManagedLaunch(paths, {
    debugPort: 0,
    executable,
    injectionEnabled: true,
    injectionTransport: "electron-preload",
  }, oldInfo, { enabled: false, values: {} }, config);

  const result = await launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: { inject: false },
    env,
    platform: "darwin",
  });
  owned.add(result.processInfo.pid);
  assert.equal(result.action, "replaced");
  await assertGone([old.pid, ...descendants, appServer.pid, modifier.pid]);
  assert.equal((await listDesktopProcesses(desktop)).length, 1);
});

test("[LAUNCH-UNKNOWN-INSTANCE-004] unknown parallel primaries fail closed", async (t) => {
  const fixture = await boundaryFixture(t);
  const { config, desktop, env, executable, owned, paths } = fixture;
  const first = spawn(executable, [], { env, stdio: "ignore" });
  const second = spawn(executable, [], { env, stdio: "ignore" });
  owned.add(first.pid);
  owned.add(second.pid);
  await Promise.all([
    waitForDesktopProcess(desktop, first.pid, 4000),
    waitForDesktopProcess(desktop, second.pid, 4000),
  ]);
  await assert.rejects(launchManagedApp({
    paths,
    config,
    relay: { enabled: false, values: {} },
    options: { inject: false },
    env,
    platform: process.platform,
  }), /发现 2 个非隔离.*拒绝/);
  assert.deepEqual(
    (await listDesktopProcesses(desktop)).map(({ pid }) => pid).sort((a, b) => a - b),
    [first.pid, second.pid].sort((a, b) => a - b),
  );
});
