import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifiedRendererDebuggerUrl } from "../src/renderer-injection.mjs";
import vm from "node:vm";
import { benchmarkTargets } from "../regression/renderer-benchmark-targets.mjs";
import { chooseSidebarScroll } from "../regression/sidebar-scroll.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("native benchmarks choose the actual editor and nested scroll viewport", () => {
  const node = (extra = {}) => ({
    getBoundingClientRect: () => ({ width: 200, height: 50 }),
    style: { visibility: "visible", display: "block", overflowY: "visible" },
    matches: () => false, closest: () => null, ...extra,
  });
  const wrapper = node();
  const unrelated = node();
  const editor = node({ matches: () => true, closest: () => wrapper });
  const viewport = node({ clientHeight: 50, scrollHeight: 200,
    style: { visibility: "visible", display: "block", overflowY: "auto" } });
  const aside = node({ querySelectorAll: () => [viewport] });
  const value = vm.runInNewContext(`(${benchmarkTargets.toString()})(${chooseSidebarScroll.toString()})`, {
    document: { querySelector: () => aside, querySelectorAll: (selector) => {
      assert.doesNotMatch(selector, /data-composer-layout/);
      return [unrelated, editor];
    } },
    getComputedStyle: (element) => element.style,
  });
  assert.equal(value.composer, editor);
  assert.equal(value.sidebar, viewport);
});

function target(overrides = {}) {
  return {
    id: "main-renderer",
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:19445/devtools/page/main-renderer",
    ...overrides,
  };
}

test("shared renderer target verifier accepts only loopback app targets with matching IDs", () => {
  assert.equal(
    verifiedRendererDebuggerUrl(target(), 19445),
    "ws://127.0.0.1:19445/devtools/page/main-renderer",
  );
  for (const candidate of [
    target({ url: "https://example.test/" }),
    target({ id: "bad/id" }),
    target({ url: "app://-/index.html?initialRoute=%2Favatar-overlay" }),
    target({ webSocketDebuggerUrl: "ws://192.0.2.1:19445/devtools/page/main-renderer" }),
    target({ webSocketDebuggerUrl: "ws://127.0.0.1:19446/devtools/page/main-renderer" }),
    target({ webSocketDebuggerUrl: "ws://127.0.0.1:19445/devtools/page/other" }),
  ]) assert.equal(verifiedRendererDebuggerUrl(candidate, 19445), null);
});

test("benchmark CLI is a thin wrapper around the one shared CDP implementation", async () => {
  const source = await fs.readFile(path.join(root, "scripts", "benchmark-renderer.mjs"), "utf8");
  assert.match(source, /runRendererBenchmark/);
  assert.doesNotMatch(source, /class\s+Session|new\s+WebSocket|\/json\/list/);
  const implementation = await fs.readFile(
    path.join(root, "regression", "renderer-benchmark.mjs"),
    "utf8",
  );
  assert.match(implementation, /openAppSession/);
  assert.match(implementation, /alignToAnimationFrame/);
  assert.match(implementation, /await alignToAnimationFrame\(session\);\s*await session\.send\("Input\.dispatchKeyEvent"/);
  assert.match(implementation,
    /const started = performance\.now\(\);\s*requestAnimationFrame\(\(\) => data\.scroll\.push/);
  assert.match(implementation,
    /await alignToAnimationFrame\(session\);\s*await session\.send\("Input\.dispatchMouseEvent"/);
  assert.doesNotMatch(implementation, /scrollStart/);
  assert.doesNotMatch(implementation, /class\s+Session|new\s+WebSocket|\/json\/list/);
});
