import test from "node:test";
import assert from "node:assert/strict";
import { RendererSession } from "../src/renderer-injection.mjs";
import { isPrimaryRendererShell, isStartupRendererShell, waitForRendererShell } from "../src/renderer-shell.mjs";

const port = 19445;
const target = {
  id: "main-renderer",
  type: "page",
  url: "app://codex/",
  webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/main-renderer`,
};

test("CDP setup failure closes its verified loopback socket", async () => {
  const original = globalThis.WebSocket;
  let socket;
  class FailingWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      socket = this;
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send() { throw new Error("synthetic CDP send failure"); }
    close() { this.closed = true; }
  }
  globalThis.WebSocket = FailingWebSocket;
  try {
    const session = new RendererSession(target, port);
    await assert.rejects(session.open(), /synthetic CDP send failure/);
    assert.equal(socket.closed, true);
  } finally {
    if (original === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = original;
  }
});

test("renderer shell predicates reject hidden and auxiliary targets", () => {
  assert.equal(isStartupRendererShell({ protocol: "app:", chatgpt: true,
    hasRoot: true, visibility: "visible" }), true);
  assert.equal(isStartupRendererShell({ protocol: "app:", chatgpt: true,
    hasRoot: true, visibility: "hidden" }), false);
  assert.equal(isPrimaryRendererShell({ protocol: "app:", hasMain: true, hasComposer: true }), true);
  assert.equal(isPrimaryRendererShell({ protocol: "app:", hasMain: true, hasComposer: false }), false);
});

test("startup waits for the actual ChatGPT root", async () => {
  const states = [
    { protocol: "app:", chatgpt: true, hasRoot: false, visibility: "visible" },
    { protocol: "app:", chatgpt: true, hasRoot: true, visibility: "visible" },
  ];
  const session = { closed: false, async evaluate() { return states.shift(); } };
  const shell = await waitForRendererShell(session, { timeoutMs: 250 });
  assert.equal(shell.hasRoot, true);
});
