import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { loadConfig, saveConfig } from "../src/config.mjs";
import { resolvePaths, PROJECT_ROOT } from "../src/paths.mjs";
import { materializeRuntime, runtimeConfigRevision } from "../src/runtime.mjs";
import { loadPayload as loadPromptPayload } from "../vendor/prompt-context/injector.mjs";
import { loadPayload as loadWallpaperPayload } from "../vendor/wallpaper-lite/injector.mjs";

test("fresh and partial configurations stay official and injection-free", async (t) => {
  const defaults = createDefaultConfig();
  assert.deepEqual(defaults.modules, {
    prompt: false,
    context: false,
    wallpaper: false,
  });

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-safe-defaults-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: directory });
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(paths.configFile, `${JSON.stringify({
    schema: defaults.schema,
    app: {},
    prompt: {},
    context: {},
    wallpaper: {},
  })}\n`, { mode: 0o600 });
  const migrated = await loadConfig(paths);
  assert.deepEqual(migrated.modules, {
    prompt: false,
    context: false,
    wallpaper: false,
  });
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-runtime-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: directory });
  const config = createDefaultConfig();
  config.prompt.profiles.push({
    id: "test",
    label: "Test",
    path: path.join(PROJECT_ROOT, "vendor", "prompt-context", "VERSION"),
  });
  config.prompt.defaultProfileId = "test";
  config.prompt.selectionRevision = 1;
  config.wallpaper.themeId = null;
  config.wallpaper.image = path.join(PROJECT_ROOT, "examples", "wallpaper.png");
  config.modules.wallpaper = true;
  await saveConfig(paths, config);
  return { config: await loadConfig(paths), paths };
}

test("runtime materialization compiles both renderer payloads", async (t) => {
  const { config, paths } = await fixture(t);
  const runtime = await materializeRuntime(config, paths);
  assert.equal(runtime.configRevision, runtimeConfigRevision(config));
  assert.equal(runtime.promptContext.profiles, 1);
  assert.equal(runtime.wallpaper.enabled, true);

  const prompt = await loadPromptPayload(runtime.paths.promptProfilesFile);
  assert.equal(runtime.promptContext.revision, prompt.revision);
  assert.equal(prompt.config.defaultProfileId, "test");
  assert.equal(prompt.config.promptSelectionRevision, 1);
  assert.equal(prompt.config.contexts.length, 6);
  assert.deepEqual(prompt.config.contexts[0], {
    id: "native",
    label: "Native / Official",
    contextWindow: null,
    autoCompactTokenLimit: null,
    scope: null,
    native: true,
  });
  assert.match(prompt.payload, /model_auto_compact_token_limit_scope/);

  const wallpaper = await loadWallpaperPayload(runtime.paths.themeDir);
  assert.equal(runtime.wallpaper.revision, wallpaper.revision);
  assert.equal(runtime.wallpaper.themeDir, runtime.paths.themeDir);
  assert.doesNotMatch(runtime.wallpaper.themeDir, /\.stage-/);
  assert.equal(wallpaper.theme.id, "codexctl-wallpaper");
  assert.ok(wallpaper.payload.length < 200_000);
  assert.ok(wallpaper.payload.length < wallpaper.imageBytes / 10);
  assert.equal(wallpaper.payload.includes("data:image/"), false);

  const preload = JSON.parse(await fs.readFile(runtime.paths.macPreloadSpecFile, "utf8"));
  assert.equal(preload.schema, "codexctl-macos-preload/1");
  assert.equal(preload.promptContext, null);
  assert.equal(preload.wallpaper.revision, wallpaper.revision);
  assert.equal(preload.wallpaper.image, "theme/wallpaper.png");
  assert.equal(preload.wallpaper.bytes, wallpaper.imageBytes);
  assert.equal(preload.wallpaper.payload.includes("data:image/"), false);
  assert.ok((await fs.stat(runtime.paths.macPreloadSpecFile)).size < 2 * 1024 * 1024);

  const reused = await materializeRuntime(config, paths);
  assert.equal(reused.reused, true);
  assert.equal(reused.committed, true);
  assert.equal(reused.promptContext.revision, runtime.promptContext.revision);
  assert.equal(reused.wallpaper.revision, runtime.wallpaper.revision);
});

test("bundled wallpaper library is portable and preserves the selected theme", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-wallpaper-library-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: directory });
  const config = createDefaultConfig();
  config.modules.wallpaper = true;
  const runtime = await materializeRuntime(config, paths);
  assert.equal(runtime.wallpaper.source, "bundled");
  assert.equal(runtime.wallpaper.themeId, "yuugohan-tsuri");

  const wallpaper = await loadWallpaperPayload(runtime.paths.themeDir);
  assert.equal(wallpaper.theme.id, "yuugohan-tsuri");
  assert.equal(wallpaper.theme.name, "ゆうごはん釣り");
  assert.equal(wallpaper.safeCssStatus, "validated");
});

test("launch Provider participates in the immutable runtime fingerprint", async (t) => {
  const { config, paths } = await fixture(t);
  const implicit = await materializeRuntime(config, paths);
  const polo = await materializeRuntime(config, paths, { launchProviderId: "polo" });
  assert.notEqual(polo.generation, implicit.generation);
  assert.notEqual(polo.fingerprint, implicit.fingerprint);
  assert.equal(polo.promptContext.defaultProviderId, "polo");
  assert.equal(polo.promptContext.launchProviderId, "polo");
  const payload = await loadPromptPayload(polo.paths.promptProfilesFile);
  assert.equal(payload.config.defaultProviderId, "polo");
  assert.equal(payload.config.launchProviderId, "polo");
  assert.doesNotMatch(
    await fs.readFile(polo.paths.promptProfilesFile, "utf8"),
    /base_url|api_key|env_key/i,
  );
});

test("relay credentials never enter persisted config or generated prompt config", async (t) => {
  const { config, paths } = await fixture(t);
  await materializeRuntime(config, paths);
  const configText = await fs.readFile(paths.configFile, "utf8");
  const current = JSON.parse(await fs.readFile(paths.runtimeCurrentFile, "utf8"));
  const promptText = await fs.readFile(
    path.join(paths.runtimeGenerationsDir, current.generation, "prompt-context.json"),
    "utf8",
  ).catch(() => "");
  assert.doesNotMatch(configText, /CODEX_APP_API_KEY|relay\.example|secret/i);
  assert.doesNotMatch(promptText, /CODEX_APP_API_KEY|relay\.example|secret/i);
});
