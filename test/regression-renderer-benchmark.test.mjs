import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifiedRendererDebuggerUrl } from "../src/renderer-injection.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
