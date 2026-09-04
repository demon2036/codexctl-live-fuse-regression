import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveConfig } from "../src/config.mjs";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { materializeRuntime, readCurrentRuntime, updateRuntimeConfig } from "../src/runtime.mjs";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

test("[INJECTION-STATIC-RESTART-002] committed runtime remains immutable until the next launch", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-static-runtime-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const paths = resolvePaths({ HOME: directory, CODEXCTL_HOME: path.join(directory, "controller") });
  const config = createDefaultConfig();
  config.modules.context = true;
  await saveConfig(paths, config);
  const first = await materializeRuntime(config, paths);
  const firstSpec = await fs.readFile(first.paths.macPreloadSpecFile);
  const installedSnapshot = Object.freeze({
    contextRevision: first.promptContext.revision,
    defaultContextId: "native",
    generation: first.generation,
  });

  await updateRuntimeConfig(paths, (draft) => {
    draft.context.defaultPresetId = "450k";
    draft.context.selectionRevision += 1;
  });
  const second = await readCurrentRuntime(paths);
  assert.notEqual(second.generation, first.generation);
  assert.notEqual(second.promptContext.revision, first.promptContext.revision);
  assert.deepEqual(await fs.readFile(first.paths.macPreloadSpecFile), firstSpec);
  assert.deepEqual(installedSnapshot, {
    contextRevision: first.promptContext.revision,
    defaultContextId: "native",
    generation: first.generation,
  });
  assert.equal(second.modules.context, true);
});

test("[INJECTION-REPEAT-NO-ACCUMULATION-003] repeated Prompt/Context payload reuses one host", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { force: true, recursive: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  harness.dispatchDocument("readystatechange");
  await harness.flush();

  const firstApi = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  const firstHost = harness.document.getElementById("codex-prompt-context-control-host");
  const listeners = {
    pointerdown: harness.listenerCount("document", "pointerdown"),
    keydown: harness.listenerCount("document", "keydown"),
    resize: harness.listenerCount("window", "resize"),
  };
  const timers = harness.timers.size;
  const result = harness.execute(fixture.loaded.payload);
  await harness.flush();

  assert.equal(result.revision, fixture.loaded.revision);
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__, firstApi);
  assert.equal(harness.document.getElementById("codex-prompt-context-control-host"), firstHost);
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-base-prompt-trigger="true"]',
  ).length, 1);
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-context-window-trigger="true"]',
  ).length, 1);
  assert.equal(harness.nodes().filter(({ id }) => id === "codex-base-prompt-switcher-style").length, 1);
  assert.deepEqual({
    pointerdown: harness.listenerCount("document", "pointerdown"),
    keydown: harness.listenerCount("document", "keydown"),
    resize: harness.listenerCount("window", "resize"),
  }, listeners);
  assert.equal(harness.timers.size, timers);
});
