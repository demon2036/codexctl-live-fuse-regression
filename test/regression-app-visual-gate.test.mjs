import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAppVisualPair } from "../regression/app-visual-gate.mjs";

function bounds(x = 0, width = 1000) {
  return { height: 700, width, x, y: 0 };
}

function fixture() {
  const region = (background, x = 0, width = 1000) => ({
    background, bounds: bounds(x, width), visible: true,
  });
  return {
    official: {
      controls: {
        context: { bounds: bounds(), count: 0, reachable: false },
        prompt: { bounds: bounds(), count: 0, reachable: false },
      },
      diagnostics: { contextRevision: null, promptRevision: null, wallpaperRevision: null },
      visual: {
        regions: {
          wallpaper: region("opaque-black"), bottom: region("opaque-black", 280, 720),
          sidebar: region("opaque-black", 0, 280), main: region("opaque-black", 280, 720),
          composer: region("opaque-black", 300, 300),
        },
        sidebarDocked: true, sidebarMainGap: 0, wallpaperVisibleMs: 0,
      },
    },
    injected: {
      controls: {
        context: { bounds: bounds(700, 100), count: 1, reachable: true },
        prompt: { bounds: bounds(580, 100), count: 1, reachable: true },
      },
      diagnostics: {
        contextRevision: "a".repeat(24), promptRevision: "a".repeat(24),
        wallpaperRevision: "b".repeat(24),
      },
      visual: {
        regions: {
          wallpaper: region("theme"), bottom: region("transparent", 280, 720),
          sidebar: region("theme", 0, 280), main: region("theme", 280, 720),
          composer: region("theme", 300, 300),
        },
        sidebarDocked: true, sidebarMainGap: 0, wallpaperVisibleMs: 120,
      },
    },
    screenshots: {
      injected: { bytes: 1200, name: "injected.png" },
      official: { bytes: 1100, name: "official.png" },
    },
  };
}

test("matched official/injected visual pair passes", () => {
  assert.deepEqual(evaluateAppVisualPair(fixture()), { failures: [], status: "pass" });
});

test("black band, overlap, late wallpaper, duplicate controls, and unsafe screenshot fail", () => {
  for (const mutate of [
    (value) => { value.injected.visual.regions.bottom.background = "opaque-black"; },
    (value) => { value.injected.visual.sidebarMainGap = -10; },
    (value) => { value.injected.visual.wallpaperVisibleMs = 751; },
    (value) => { value.injected.controls.prompt.count = 2; },
    (value) => { value.screenshots.injected.name = "../private.png"; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.equal(evaluateAppVisualPair(value).status, "fail");
  }
});
