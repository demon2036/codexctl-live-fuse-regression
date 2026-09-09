import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  assessWallpaperDiagnostics,
  compileSource,
  createRendererBlob,
  installIntoSession,
  loadPayload,
  optimizeWallpaperCss,
  WALLPAPER_TRANSFER_CHUNK_BYTES,
} from "../vendor/wallpaper-lite/injector.mjs";
import { buildWallpaperCss } from "../vendor/wallpaper-lite/wallpaper-css.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const themeDir = path.resolve(here, "../assets/wallpapers/yuugohan-tsuri");

class FakeClassList {
  constructor(values = []) { this.values = new Set(values); }
  contains(value) { return this.values.has(value); }
  add(value) { this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
}

class FakeNode {
  constructor(tag, classes = []) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classList = new FakeClassList(classes);
    this.id = "";
    this.textContent = "";
    const properties = new Map();
    this.style = {
      setProperty(name, value) { properties.set(name, String(value)); },
      removeProperty(name) { properties.delete(name); },
      getPropertyValue(name) { return properties.get(name) ?? ""; },
    };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children
      .filter((child) => child !== this);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

function runRenderer(payload) {
  const root = new FakeNode("html", ["electron-light"]);
  const head = root.appendChild(new FakeNode("head"));
  const body = root.appendChild(new FakeNode("body"));
  const flatten = (node) => [node, ...node.children.flatMap(flatten)];
  const document = {
    documentElement: root,
    head,
    body,
    createElement(tag) { return new FakeNode(tag); },
    getElementById(id) { return flatten(root).find((node) => node.id === id) ?? null; },
  };
  const window = { window: null };
  window.window = window;
  const context = vm.createContext({
    window,
    document,
    URL: { revokeObjectURL() {} },
  });
  const execute = (source) => new vm.Script(source).runInContext(context);
  execute(payload);
  return { window, document, root, execute, nodes: () => flatten(root) };
}

test("compiled wallpaper is a small static one-shot payload", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  assert.equal(loaded.mime, "image/webp");
  assert.equal(loaded.config.engine, "codexctl-wallpaper-once/4");
  assert.equal(loaded.config.performanceProfile, "one-shot-compositor");
  assert.ok(Buffer.byteLength(loaded.payload) < 16_000);
  assert.match(loaded.payload, /blob:codexctl-test/);
  assert.doesNotMatch(
    loaded.payload,
    /data:image|MutationObserver|setInterval|setTimeout|addEventListener|:has\(/,
  );
  assert.doesNotMatch(loaded.payload, /backdrop-filter:\s*blur/i);
});

test("[WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001] wallpaper preserves docked geometry and covers floating chat with art", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const css = buildWallpaperCss(loaded.source);
  assert.match(css, /@layer codexctl-wallpaper-structure, dreamskin-community/);
  assert.match(css, /rgba\(7, 25, 29, 0\.180\)/);
  assert.doesNotMatch(css, /rgba\(7, 25, 29, 0\.720\)/);
  assert.match(css, /data-app-action-sidebar-scroll/);
  assert.match(css, /bg-token-main-surface-primary/);
  assert.match(css, /data-app-shell-focus-area="bottom-panel"/);
  assert.match(css, /data-app-shell-left-panel-appearance/);
  const sidebar = css.match(/\)\s*\{([^}]*background: linear-gradient\(90deg[^}]+)\}/);
  assert.ok(sidebar, "docked Sidebar theme rule must be present");
  assert.doesNotMatch(sidebar[1], /\bcontain\s*:|\bisolation\s*:|\bwill-change\s*:|\btransform\s*:/);
  assert.match(css, /app-shell-floating-left-panel/);
  assert.doesNotMatch(css, /:has\(|position:\s*fixed|background-attachment:\s*fixed/);
});

test("wallpaper paints the document background without creating a native stacking context", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const css = buildWallpaperCss(loaded.source);
  const rootRule = css.match(/html\[data-codexctl-wallpaper="active"\]\s*\{([^}]+)\}/);
  assert.ok(rootRule, "wallpaper root paint rule must be present");
  assert.match(rootRule[1], /background-image:[^;]*var\(--codexctl-wallpaper-art\)/);
  assert.doesNotMatch(rootRule[1],
    /(?:^|\n)\s*(?:contain|isolation|position|z-index|transform)\s*:/);
  assert.doesNotMatch(css, /html\[data-codexctl-wallpaper="active"\]::before/);
  assert.match(css, /:is\(body, #root\)\s*\{/);
  const bottomRule = css.match(
    /:is\(\s*\[data-app-shell-focus-area="bottom-panel"\][\s\S]*?\)\s*\{([^}]+)\}/,
  );
  assert.ok(bottomRule, "bottom-panel transparency rule must be present");
  assert.match(bottomRule[1], /background:\s*transparent\s*!important/);
  assert.doesNotMatch(bottomRule[1], /rgba|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(css, /rgba\(11, 36, 42, 0\.640\)/);
});

test("wallpaper removes the real thread-scroll bottom surface gradient", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const css = buildWallpaperCss(loaded.source);
  const threadFadeRule = css.match(
    /\.thread-scroll-container\s+\.bg-gradient-to-t\.from-surface\.via-surface\s*\{([^}]+)\}/,
  );
  assert.ok(threadFadeRule, "real App thread bottom-gradient selector must be present");
  assert.match(threadFadeRule[1], /background-image:\s*none\s*!important/);
  assert.doesNotMatch(threadFadeRule[1], /rgb\(17,\s*17,\s*17\)|#111/i);
  assert.doesNotMatch(css,
    /html\[data-codexctl-wallpaper="active"\]\s+\.thread-scroll-container\s*\{[^}]*(?:contain|isolation)\s*:/);
});

test("wallpaper paints the composer without clipping or restacking native popovers", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const css = buildWallpaperCss(loaded.source);
  const composerRule = css.match(
    /:is\(\s*\.composer-surface-chrome,\s*\[data-composer-layout\],\s*\[data-codex-composer-root\]\s*\)\s*\{([^}]+)\}/,
  );
  assert.ok(composerRule, "composer theme rule must be present");
  assert.match(composerRule[1], /background-color:\s*rgba\(11, 36, 42, 0\.760\)\s*!important/);
  assert.doesNotMatch(composerRule[1], /\bcontain\s*:|\bisolation\s*:|\bz-index\s*:|\btransform\s*:/);
  assert.doesNotMatch(css,
    /:is\(\s*\.composer-surface-chrome,\s*\[data-composer-layout\],\s*\[data-codex-composer-root\]\s*\)::before/);
});

test("[PLATFORM-LINUX-RENDERER-SURFACE-005] themes the latest Codex composer root", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const css = buildWallpaperCss(loaded.source);

  assert.match(css, /:is\([^)]*\[data-codex-composer-root\][^)]*\)\s*\{/);
  assert.doesNotMatch(css, /:is\([^)]*\[data-codex-composer-root\][^)]*\)::before\s*\{/);
});

test("renderer installs with zero observers/timers and restores appearance on cleanup", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-test" });
  const harness = runRenderer(loaded.payload);
  const state = harness.window.__CODEXCTL_WALLPAPER_V2__;
  const diagnostics = state.diagnostics();
  assert.equal(diagnostics.installed, true);
  assert.equal(diagnostics.metrics.observers, 0);
  assert.equal(diagnostics.metrics.timers, 0);
  assert.equal(harness.root.classList.contains("electron-dark"), true);
  assert.equal(harness.root.classList.contains("electron-light"), false);
  assert.equal(state.cleanup(), true);
  assert.equal(harness.root.classList.contains("electron-light"), true);
  assert.equal(harness.root.getAttribute("data-codexctl-wallpaper"), null);
  assert.equal(harness.root.style.getPropertyValue("--codexctl-wallpaper-art"), "");
  assert.equal(harness.document.getElementById("codexctl-wallpaper-v2-style"), null);
  assert.equal(state.cleanup(), false, "cleanup must be idempotent");
});

test("[INJECTION-REPEAT-NO-ACCUMULATION-003] repeating the same wallpaper revision is strictly idempotent", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-repeat" });
  const harness = runRenderer(loaded.payload);
  const firstState = harness.window.__CODEXCTL_WALLPAPER_V2__;
  const firstStyle = harness.document.getElementById("codexctl-wallpaper-v2-style");

  const diagnostics = harness.execute(loaded.payload);
  assert.equal(diagnostics.revision, loaded.revision);
  assert.equal(harness.window.__CODEXCTL_WALLPAPER_V2__, firstState);
  assert.equal(harness.document.getElementById("codexctl-wallpaper-v2-style"), firstStyle);
  assert.equal(harness.nodes().filter((node) => node.id === "codexctl-wallpaper-v2-style").length, 1);
  assert.equal(diagnostics.metrics.installs, 1);
});

test("a new wallpaper revision atomically replaces the old style", async () => {
  const loaded = await loadPayload(themeDir, { artUrl: "blob:codexctl-first" });
  const harness = runRenderer(loaded.payload);
  const firstState = harness.window.__CODEXCTL_WALLPAPER_V2__;
  const changed = compileSource({
    ...loaded.source,
    theme: {
      ...loaded.source.theme,
      id: "regression-replacement",
      tuning: { ...loaded.source.theme.tuning, sidebarOpacity: 0.31 },
    },
  }, "blob:codexctl-second");

  const diagnostics = harness.execute(changed.payload);
  assert.notEqual(diagnostics.revision, loaded.revision);
  assert.equal(diagnostics.revision, changed.revision);
  assert.equal(firstState.cleanup(), false, "the old state must already be stopped");
  assert.equal(harness.nodes().filter((node) => node.id === "codexctl-wallpaper-v2-style").length, 1);
  assert.equal(harness.window.__CODEXCTL_WALLPAPER_V2__.themeId, "regression-replacement");
});

test("safe theme CSS rejects relational selectors and removes compositor filters", () => {
  assert.throws(() => optimizeWallpaperCss('[data-ds-part="root"]:has(span){}'), /:has/);
  const css = optimizeWallpaperCss('[data-ds-part="composer"]{backdrop-filter:blur(12px);filter:contrast(2)}');
  assert.match(css, /backdrop-filter: none/);
  assert.match(css, /filter: none/);
});

test("wallpaper bytes cross CDP in bounded chunks", async () => {
  const art = Buffer.alloc(WALLPAPER_TRANSFER_CHUNK_BYTES * 2 + 17, 0x5a);
  let accepted = 0;
  const expressions = [];
  const session = {
    async evaluate(expression) {
      expressions.push(expression);
      if (expression.includes("transfer:chunk")) {
        const encoded = JSON.parse(expression.match(/atob\(("[^"]+")\)/)[1]);
        accepted += Buffer.from(encoded, "base64").length;
        return accepted;
      }
      if (expression.includes("transfer:commit")) {
        return { revision: "chunked", url: "blob:chunked", bytes: art.length, mime: "image/png" };
      }
      return { complete: false };
    },
  };
  const result = await createRendererBlob(session, {
    art,
    mime: "image/png",
    revision: "chunked",
    source: {},
  });
  assert.equal(result.bytes, art.length);
  assert.equal(expressions.filter((value) => value.includes("transfer:chunk")).length, 3);
  assert.ok(expressions.every((value) => Buffer.byteLength(value) < 280_000));
});

test("diagnostics require the zero-background-work contract", () => {
  const base = {
    installed: true,
    revision: "revision",
    themeId: "theme",
    artReady: true,
    stylePresent: true,
    rootAttribute: "on",
    metrics: { observers: 0, timers: 0 },
  };
  assert.equal(assessWallpaperDiagnostics(base, {
    revision: "revision", themeId: "theme",
  }).pass, true);
  assert.equal(assessWallpaperDiagnostics({
    ...base, metrics: { observers: 1, timers: 0 },
  }).pass, false);
});

test("one-shot install confirms the exact compiled revision", async () => {
  const loaded = await loadPayload(themeDir);
  const prepared = compileSource(loaded.source, "blob:cached");
  const session = {
    async evaluate(expression) {
      if (expression.includes("const blobs = window.__CODEXCTL")) {
        return { complete: true, record: {
          revision: loaded.revision,
          url: "blob:cached",
          bytes: loaded.art.length,
          mime: loaded.mime,
        } };
      }
      if (expression.includes("?.diagnostics")) return {
        installed: true,
        revision: prepared.revision,
        themeId: prepared.theme.id,
        artReady: true,
        stylePresent: true,
        rootAttribute: "on",
        metrics: { observers: 0, timers: 0 },
      };
      return true;
    },
  };
  const record = { session };
  const diagnostics = await installIntoSession(record, loaded);
  assert.equal(diagnostics.pass, true);
  assert.equal(record.revision, prepared.revision);
});
