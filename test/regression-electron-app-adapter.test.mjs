import test from "node:test";
import assert from "node:assert/strict";
import * as adapter from "../regression/electron-app-adapter.mjs";
import { injectedModulesReady } from "../regression/app-cdp.mjs";

test("isolated App diagnostics can select module boundaries without changing defaults", () => {
  assert.equal(typeof adapter.normalizeFixtureModules, "function");
  const { normalizeFixtureModules } = adapter;
  assert.deepEqual(normalizeFixtureModules(), {
    context: true, prompt: true, wallpaper: true,
  });
  assert.deepEqual(normalizeFixtureModules({
    context: false, prompt: false, wallpaper: true,
  }), { context: false, prompt: false, wallpaper: true });
});

test("isolated App module selection rejects partial, unknown, and non-boolean input", () => {
  assert.equal(typeof adapter.normalizeFixtureModules, "function");
  const { normalizeFixtureModules } = adapter;
  assert.throws(() => normalizeFixtureModules({ wallpaper: true }), /exact booleans/);
  assert.throws(() => normalizeFixtureModules({
    context: false, prompt: false, wallpaper: true, worker: true,
  }), /exact booleans/);
  assert.throws(() => normalizeFixtureModules({
    context: false, prompt: "false", wallpaper: true,
  }), /exact booleans/);
});

test("isolated App waits only for the selected injection modules", () => {
  assert.equal(injectedModulesReady({
    context: 0, manager: null, prompt: 0, wallpaper: true,
  }, { context: false, prompt: false, wallpaper: true }), true);
  assert.equal(injectedModulesReady({
    context: 1, manager: "ready", prompt: 1, wallpaper: false,
  }, { context: true, prompt: true, wallpaper: false }), true);
  assert.equal(injectedModulesReady({
    context: 0, manager: null, prompt: 0, wallpaper: false,
  }, { context: false, prompt: false, wallpaper: true }), false);
});
