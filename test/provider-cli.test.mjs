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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-provider-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = path.join(directory, "state");
  const env = { ...process.env, HOME: directory, CODEXCTL_HOME: state };
  const config = createDefaultConfig();
  if (process.platform === "darwin") {
    const bundle = path.join(directory, "Codex.app");
    const executable = path.join(bundle, "Contents", "MacOS", "Codex");
    const cli = path.join(bundle, "Contents", "Resources", "codex");
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.mkdir(path.dirname(cli), { recursive: true });
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    config.app.path = bundle;
  } else if (process.platform === "linux") {
    const executable = path.join(directory, "codex-desktop");
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

test("app --provider exposes an explicit launch default in dry-run output", async (t) => {
  const { env } = await fixture(t);
  const command = path.join(PROJECT_ROOT, "bin", "codexctl.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    command, "app", "--inject", "--provider", "polo", "--dry-run",
  ], { env });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.provider, { defaultId: "polo", explicit: true });

  await assert.rejects(
    execFileAsync(process.execPath, [command, "app", "--provider", "polo", "--dry-run"], { env }),
    (error) => /--provider 需要与 --inject 一起使用/.test(String(error.stderr)),
  );
});
