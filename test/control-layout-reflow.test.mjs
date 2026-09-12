import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

async function setup(t) {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  footer.setBoundingClientRect({ left: 80, top: 600, width: 800, height: 48 });
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  composer.setBoundingClientRect({ left: 80, top: 560, width: 700, height: 36 });
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  permission.setBoundingClientRect({ left: 100, top: 600, width: 90, height: 30 });
  const native = harness.document.createElement("button");
  native.setAttribute("data-composer-navigation-target", "model");
  native.setBoundingClientRect({ left: 700, top: 600, width: 100, height: 30 });
  footer.append(composer, permission, native);
  harness.document.body.appendChild(footer);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  return { harness, footer, native, permission };
}

const externalTarget = { closest() { return null; } };

test("an external sidebar reflow repositions controls without a window resize", async (t) => {
  const { harness, footer, permission } = await setup(t);
  const host = harness.document.getElementById("codex-prompt-context-control-host");
  const before = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(host.style.left, "195px");
  footer.setBoundingClientRect({ left: 360, top: 600, width: 520, height: 48 });
  permission.setBoundingClientRect({ left: 380, top: 600, width: 90, height: 30 });
  harness.dispatchDocument("pointerdown", { target: externalTarget });
  await harness.flush();
  const after = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(host.style.left, "475px");
  assert.equal(host.hidden, false);
  assert.equal(after.uiMetrics.positionPasses, before.uiMetrics.positionPasses + 1);
});

test("control hit testing looks through its own stale host to Permissions", async (t) => {
  const { harness, permission } = await setup(t);
  const host = harness.document.getElementById("codex-prompt-context-control-host");
  const ownControl = host.children[0];
  const originalHits = harness.document.elementsFromPoint.bind(harness.document);
  harness.document.elementsFromPoint = (x, y) => {
    const hits = originalHits(x, y);
    return hits.includes(permission) ? [ownControl, ...hits] : hits;
  };
  harness.dispatchWindow("resize");
  await harness.flush();
  assert.equal(host.hidden, false);
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().controlContextAvailable,
    true,
  );
});

test("a native footer action recomputes the owner boundary in both directions", async (t) => {
  const { harness, native } = await setup(t);
  const host = harness.document.getElementById("codex-prompt-context-control-host");
  const before = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  const originalWidth = host.getBoundingClientRect().width;
  assert.ok(host.getBoundingClientRect().right <= native.getBoundingClientRect().left);

  native.setBoundingClientRect({ left: 500, top: 600, width: 100, height: 30 });
  harness.dispatchDocument("pointerdown", { target: native });
  await harness.flush();
  assert.ok(host.getBoundingClientRect().width < originalWidth);
  assert.ok(host.getBoundingClientRect().right <= native.getBoundingClientRect().left);

  native.setBoundingClientRect({ left: 700, top: 600, width: 100, height: 30 });
  harness.dispatchDocument("pointerdown", { target: native });
  await harness.flush();
  assert.equal(host.getBoundingClientRect().width, originalWidth);
  assert.ok(host.getBoundingClientRect().right <= native.getBoundingClientRect().left);
  const after = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.ok(after.uiMetrics.positionPasses > before.uiMetrics.positionPasses);
  assert.ok(after.uiMetrics.positionPasses <= before.uiMetrics.positionPasses + 5);
});

test("stable external pointerdowns add no full reposition or timer", async (t) => {
  const { harness } = await setup(t);
  const before = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  const timerCount = harness.timers.size;
  for (let index = 0; index < 100; index += 1) {
    harness.dispatchDocument("pointerdown", { target: externalTarget });
  }
  await harness.flush();
  const after = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(after.uiMetrics.positionPasses, before.uiMetrics.positionPasses);
  assert.equal(harness.timers.size, timerCount);
});

test("a foreign overlay still invalidates the Permissions hit target", async (t) => {
  const { harness } = await setup(t);
  const host = harness.document.getElementById("codex-prompt-context-control-host");
  const overlay = harness.document.createElement("div");
  harness.document.body.appendChild(overlay);
  harness.document.elementFromPoint = () => overlay;
  harness.document.elementsFromPoint = () => [overlay];
  harness.dispatchWindow("resize");
  await harness.flush();
  assert.equal(host.hidden, true);
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().controlContextAvailable,
    false,
  );
});
