import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { planAppLaunch } from "../src/platform.mjs";
import { parseProjectPolicy, validateProjectPolicy } from "../src/project-policy.mjs";
import { parseRelayOverrides } from "../src/relay.mjs";

const POLICY = `schema: codexctl/project-policy/1
launch:
  defaultMode: remote-safe
  injection: explicit
  macOfficial: launch-services
  officialCli: embedded
environment:
  persist: false
relay:
  proxy: http://127.0.0.1:10808
  noProxy: localhost,127.0.0.1,::1
`;

async function writeProtectedFixtures(home) {
  const entries = new Map([
    [path.join(home, ".codex", "config.toml"), Buffer.from(
      "model_provider = \"crs\"\n[model_providers.crs]\nbase_url = \"https://old.invalid\"\n",
    )],
    [path.join(home, ".zshrc"), Buffer.from("export KEEP_ZSH=1\n")],
    [path.join(home, ".bashrc"), Buffer.from("export KEEP_BASH=1\n")],
    [path.join(home, "Library", "LaunchAgents", "fixture.plist"), Buffer.from("fixture-agent\n")],
    [path.join(home, ".config", "systemd", "user", "fixture.service"), Buffer.from("fixture-unit\n")],
  ]);
  for (const [filename, contents] of entries) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, contents);
  }
  return entries;
}

async function assertByteIdentical(entries) {
  for (const [filename, expected] of entries) {
    assert.deepEqual(await fs.readFile(filename), expected, `${filename} changed`);
  }
}

test("[CONFIG-PROXY-SCOPE-002] credential-free project proxy is launch-local", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-config-scope-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const protectedFiles = await writeProtectedFixtures(directory);
  const app = path.join(directory, "chatgpt");
  const cli = path.join(directory, "codex");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const policy = validateProjectPolicy(parseProjectPolicy(POLICY));
  const relay = parseRelayOverrides([
    "url=https://relay.example/v1;key=fixture-only",
  ], {}, policy.relay);
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.cliPath = cli;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "controller") });
  const plan = await planAppLaunch(config, paths, relay, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "linux");
  assert.equal(plan.environment.HTTP_PROXY, "http://127.0.0.1:10808");
  assert.equal(plan.environment.CODEX_APP_API_KEY, "fixture-only");
  assert.ok(plan.argv.includes("--proxy-server=http://127.0.0.1:10808"));
  await assertByteIdentical(protectedFiles);
});

test("[CONFIG-PROVIDER-PRESERVE-003] unknown crs config is never rewritten or injected", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-provider-preserve-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const protectedFiles = await writeProtectedFixtures(directory);
  const app = path.join(directory, "chatgpt");
  const cli = path.join(directory, "codex");
  await fs.writeFile(app, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const config = createDefaultConfig();
  config.app.path = app;
  config.app.cliPath = cli;
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "controller") });
  const plan = await planAppLaunch(config, paths, { enabled: false, values: {} }, {}, {
    HOME: directory,
    PATH: "/usr/bin:/bin",
  }, "linux");
  assert.doesNotMatch(JSON.stringify([plan.argv, plan.environment]), /crs|model_provider/);
  await assertByteIdentical(protectedFiles);
});

test("[CONFIG-PROXY-SCOPE-002] credential and malformed relay failures preserve every user file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-config-failure-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const protectedFiles = await writeProtectedFixtures(directory);
  assert.throws(() => validateProjectPolicy(parseProjectPolicy(
    POLICY.replace("http://127.0.0.1:10808", "http://user:secret@127.0.0.1:10808"),
  )), /凭据/);
  assert.throws(() => parseRelayOverrides([
    "url=https://relay.example/v1;key=fixture;proxy=http://user:secret@127.0.0.1:10808",
  ]), /凭据/);
  assert.throws(() => parseRelayOverrides([
    "url=https://relay.example/v1;key=fixture;unknown=value",
  ]), /未知/);
  await assertByteIdentical(protectedFiles);
});
