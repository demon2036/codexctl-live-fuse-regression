import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import { planAppLaunch } from "../src/platform.mjs";
import { resolvePaths } from "../src/paths.mjs";

async function macBundle(directory) {
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { bundle, cli };
}

test("[CONFIG-DEFAULTS-001] fresh config is Default Prompt, Native Context, and opt-in modules", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-defaults-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const config = await loadConfig(paths);
  assert.equal(config.prompt.defaultProfileId, "default");
  assert.equal(config.context.defaultPresetId, "native");
  assert.deepEqual(config.modules, { context: false, prompt: false, wallpaper: false });
  assert.deepEqual(
    config.context.presets.find(({ id }) => id === "native"),
    {
      autoCompactTokenLimit: null,
      builtin: true,
      contextWindow: null,
      id: "native",
      label: "Native / Official",
      native: true,
      scope: null,
    },
  );
});

test("[CONFIG-DEFAULTS-001] official launch pins the App embedded CLI and injects no provider", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-default-provider-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const { bundle, cli } = await macBundle(directory);
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "state") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/tmp/untrusted-bin:/usr/bin:/bin",
    CODEX_APP_BASE_URL: "https://stale.invalid",
    CODEX_APP_API_KEY: "stale-fixture",
  }, "darwin");
  assert.equal(plan.launchMethod, "launch-services");
  assert.deepEqual(plan.argv, []);
  assert.equal(plan.desktop.officialCli, cli);
  assert.equal(plan.environment.CODEX_CLI_PATH, cli);
  assert.equal(plan.environment.CODEX_APP_BASE_URL, undefined);
  assert.equal(plan.environment.CODEX_APP_API_KEY, undefined);
});
