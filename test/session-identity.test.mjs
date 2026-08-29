import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { planAppLaunch } from "../src/platform.mjs";
import { parseRelayOverrides } from "../src/relay.mjs";

async function macFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-session-identity-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const bundle = path.join(directory, "ChatGPT.app");
  const executable = path.join(bundle, "Contents", "MacOS", "ChatGPT");
  const cli = path.join(bundle, "Contents", "Resources", "codex");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = bundle;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "controller") });
  return { config, directory, paths };
}

test("[CONFIG-SESSION-IDENTITY-004] primary official and injected launches keep the production profile", async (t) => {
  const { config, directory, paths } = await macFixture(t);
  const staleProfile = path.join(directory, "stale-test-profile");
  const codexHome = path.join(directory, ".codex");
  const env = {
    HOME: directory,
    PATH: "/tmp/untrusted-cli:/usr/bin:/bin",
    CODEX_HOME: codexHome,
    CODEX_ELECTRON_USER_DATA_PATH: staleProfile,
  };
  const official = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, env, "darwin");
  config.modules.context = true;
  const injected = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    inject: true,
    preloadSpecFile: path.join(directory, "runtime", "macos-preload.json"),
  }, env, "darwin");

  for (const plan of [official, injected]) {
    assert.equal(plan.environment.HOME, directory);
    assert.equal(plan.environment.CODEX_HOME, codexHome);
    assert.equal(plan.environment.CODEX_ELECTRON_USER_DATA_PATH, undefined);
    assert.equal(plan.argv.some((argument) => argument.startsWith("--user-data-dir")), false);
  }
});

test("[CONFIG-SESSION-IDENTITY-004] relay and PATH CLI cannot select a different main profile", async (t) => {
  const { config, directory, paths } = await macFixture(t);
  const relay = parseRelayOverrides(["url=https://relay.example/v1;key=fixture"]);
  const plan = await planAppLaunch(config, paths, relay, {}, {
    HOME: directory,
    PATH: "/tmp/untrusted-cli:/usr/bin:/bin",
    CODEX_ELECTRON_USER_DATA_PATH: path.join(directory, "stale-test-profile"),
  }, "darwin");
  assert.equal(plan.environment.CODEX_ELECTRON_USER_DATA_PATH, undefined);
  assert.equal(plan.argv.some((argument) => argument.startsWith("--user-data-dir")), false);
  assert.equal(plan.desktop.officialCli, path.join(
    config.app.path,
    "Contents",
    "Resources",
    "codex",
  ));
});

test("[CONFIG-SESSION-IDENTITY-004] test profile is explicit and distinct from production", async (t) => {
  const { config, directory, paths } = await macFixture(t);
  const profile = path.join(directory, "regression", "profile");
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {
    isolatedProfile: profile,
  }, { HOME: directory, PATH: "/usr/bin:/bin" }, "darwin");
  assert.equal(plan.environment.CODEX_ELECTRON_USER_DATA_PATH, profile);
  assert.ok(plan.argv.includes(`--user-data-dir=${profile}`));
  assert.notEqual(profile, path.join(directory, "Library", "Application Support", "ChatGPT"));
});

test("primary launch rejects a manually supplied user-data-dir", async (t) => {
  const { config, directory, paths } = await macFixture(t);
  config.app.extraArgs = [`--user-data-dir=${path.join(directory, "hidden-history")}`];
  await assert.rejects(planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "darwin"), /user-data-dir.*isolated/i);
});
