import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

test("a non-interactive footer wrapper does not consume the native-control boundary", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  footer.setBoundingClientRect({ left: 80, top: 520, width: 800, height: 120 });
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  composer.setBoundingClientRect({ left: 100, top: 530, width: 740, height: 60 });
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  permission.setBoundingClientRect({ left: 100, top: 600, width: 90, height: 28 });
  const nativeLayoutWrapper = harness.document.createElement("div");
  nativeLayoutWrapper.setBoundingClientRect({ left: 195, top: 600, width: 620, height: 28 });
  const modelButton = harness.document.createElement("button");
  modelButton.setAttribute("data-composer-navigation-target", "model");
  modelButton.setBoundingClientRect({ left: 600, top: 600, width: 110, height: 28 });
  nativeLayoutWrapper.appendChild(modelButton);
  footer.append(composer, permission, nativeLayoutWrapper);
  harness.document.body.appendChild(footer);

  harness.dispatchDocument("readystatechange");
  await harness.flush();

  const host = harness.document.getElementById("codex-prompt-context-control-host");
  assert.ok(host);
  assert.equal(host.hidden, false, "layout wrappers are not native hit targets");
  assert.equal(host.style.maxWidth, "400px");
  assert.equal(host.querySelectorAll('[data-codex-base-prompt-trigger="true"]').length, 1);
  assert.equal(host.querySelectorAll('[data-codex-context-window-trigger="true"]').length, 1);
  assert.equal(host.querySelectorAll('[data-codex-provider-indicator="true"]').length, 1);
  assert.deepEqual(modelButton.getBoundingClientRect(), {
    x: 600, y: 600, top: 600, right: 710, bottom: 628,
    left: 600, width: 110, height: 28,
  });
});
