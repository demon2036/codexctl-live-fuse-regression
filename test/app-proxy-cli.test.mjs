import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { saveConfig } from "../src/config.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import { PROJECT_ROOT, resolvePaths } from "../src/paths.mjs";

const execFileAsync = promisify(execFile);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-app-proxy-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = path.join(directory, "state");
  const env = { ...process.env, HOME: directory, CODEXCTL_HOME: state };
  const config = createDefaultConfig();
  if (process.platform === "darwin") {
    const bundle = path.join(directory, "ChatGPT.app");
    const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
    const cli = path.join(bundle, "Contents", "Resources", "codex");
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.mkdir(path.dirname(cli), { recursive: true });
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    config.app.path = bundle;
  } else if (process.platform === "linux") {
    const executable = path.join(directory, "chatgpt");
    const cli = path.join(directory, "codex");
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    config.app.path = executable;
    config.app.cliPath = cli;
  } else {
    throw new Error(`Unsupported test platform: ${process.platform}`);
  }
  config.modules.context = true;
  await saveConfig(resolvePaths(env), config);
  return { env };
}

test("app accepts inline --proxy-server for an official OAuth dry run", async (t) => {
  const { env } = await fixture(t);
  const command = path.join(PROJECT_ROOT, "bin", "codexctl.mjs");
  const proxyServer = "http://127.0.0.1:10808";
  const { stdout } = await execFileAsync(process.execPath, [
    command,
    "app",
    "--inject",
    `--proxy-server=${proxyServer}`,
    "--dry-run",
  ], { env });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.connection, { mode: "official" });
  assert.ok(result.launch.argv.includes(`--proxy-server=${proxyServer}`));
  assert.equal(result.launch.environment.HTTP_PROXY, proxyServer);
  assert.equal(result.launch.environment.NO_PROXY, "localhost,127.0.0.1,::1");
  if (process.platform === "darwin") {
    assert.equal(result.launch.launchMethod, "launch-services");
    assert.equal(result.launch.injectionTransport, "electron-preload");
    assert.equal(result.launch.debugPort, 0);
  }
});
