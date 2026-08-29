import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBottomLayers,
  classifyPlatformShell,
  evaluatePlatformRendererEvidence,
  platformShellInteractive,
} from "../regression/platform-renderer-probe.mjs";

const revision = "a".repeat(24);

function evidence(overrides = {}) {
  return {
    controls: {
      context: { count: 1, reachable: true },
      prompt: { count: 1, reachable: true },
    },
    diagnostics: {
      contextRevision: revision,
      managerStatus: "ready",
      promptRevision: revision,
      wallpaperRevision: revision,
    },
    fades: [{ background: "transparent" }],
    installation: {
      promptGlobal: true, promptStyles: 1, wallpaperGlobal: true, wallpaperStyles: 1,
    },
    interactive: true,
    metrics: { layoutReads: 0, observerCount: 0, reconciles: 0, timerCount: 0, workerCount: 0 },
    reasonCodes: [],
    regions: {
      bottom: { background: "transparent" }, composer: { background: "theme" },
      main: { background: "theme" }, sidebar: { background: "theme" },
      wallpaper: { background: "theme" },
    },
    screenshot: { bytes: 400, sha256: "b".repeat(64) },
    sidebarDocked: true,
    sidebarScroll: { found: true, overflowing: true },
    status: "pass",
    ...overrides,
  };
}

test("real renderer gate accepts clean official and complete injected surfaces", () => {
  const official = evidence({
    installation: {
      promptGlobal: false, promptStyles: 0, wallpaperGlobal: false, wallpaperStyles: 0,
    },
  });
  assert.equal(evaluatePlatformRendererEvidence({ mode: "official", value: official }).status, "pass");
  assert.equal(evaluatePlatformRendererEvidence({ mode: "injected", value: evidence() }).status, "pass");
});

test("real renderer gate preserves missing login as unverified", () => {
  assert.deepEqual(evaluatePlatformRendererEvidence({
    mode: "injected",
    value: evidence({ reasonCodes: ["interactive-shell-unavailable"], status: "unverified" }),
  }), {
    failures: [], reasonCodes: ["interactive-shell-unavailable"], status: "unverified",
  });
});

test("real renderer gate catches black bottom, overlap, missing controls, and steady work", () => {
  const value = evidence({
    controls: { context: { count: 0, reachable: false }, prompt: { count: 2, reachable: true } },
    metrics: { layoutReads: 1, observerCount: 0, reconciles: 0, timerCount: 0, workerCount: 0 },
    regions: { ...evidence().regions, bottom: { background: "opaque-black" } },
    sidebarDocked: false,
  });
  const result = evaluatePlatformRendererEvidence({ mode: "injected", value });
  assert.equal(result.status, "fail");
  for (const code of ["bottom-not-transparent", "sidebar-overlap", "context-count", "steady-work"]) {
    assert.ok(result.failures.includes(code));
  }
});

test("actual package shell diagnostics classify blockers without returning page text", () => {
  assert.equal(classifyPlatformShell("Sign in with ChatGPT"), "authentication-required");
  assert.equal(classifyPlatformShell("Open folder"), "workspace-required");
  assert.equal(classifyPlatformShell("You don’t have access to Codex yet."), "access-restricted");
  assert.equal(classifyPlatformShell("Codex is still starting"), "loading");
  assert.equal(classifyPlatformShell("private unknown content"), "unknown");
  assert.equal(classifyPlatformShell("private unknown content", true), "interactive");
});

test("[PLATFORM-LINUX-RENDERER-SURFACE-005] latest package shell does not require its optional terminal panel", () => {
  const shell = {
    bottomPanel: null,
    composerRoot: {},
    editor: {},
    main: {},
    sidebar: {},
    sidebarScroll: { clientHeight: 700, scrollHeight: 700 },
  };
  assert.equal(platformShellInteractive(shell), true);
  assert.equal(platformShellInteractive({ ...shell, composerRoot: null }), false);
  assert.equal(platformShellInteractive({ ...shell, sidebarScroll: null }), false);
});

test("latest package bottom strip inspects every covering surface and Sessions must really scroll", () => {
  assert.equal(classifyBottomLayers(["transparent", "opaque-black", "theme"]), "opaque-black");
  assert.equal(classifyBottomLayers(["transparent", "theme"]), "theme");
  assert.equal(classifyBottomLayers(["transparent", "transparent"]), "transparent");
  assert.equal(classifyBottomLayers([]), "missing");
  const result = evaluatePlatformRendererEvidence({
    mode: "official",
    value: evidence({ sidebarScroll: { found: true, overflowing: false } }),
  });
  assert.equal(result.status, "fail");
  assert.ok(result.failures.includes("sessions-not-scrollable"));
});
