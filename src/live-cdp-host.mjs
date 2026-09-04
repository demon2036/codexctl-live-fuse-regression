import { EventEmitter } from "node:events";
import hostRendererModule from "./live-host-renderer.cjs";
import { RendererSession, rendererTargets } from "./renderer-injection.mjs";

const { LiveHostRenderer } = hostRendererModule;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BROWSER_ID = /^[A-Za-z0-9._-]{1,220}$/;
const LIVE_ACTION_BINDING = "__codexctlLiveAction";

function verifiedBrowserDebuggerUrl(value, port) {
  try {
    const url = new URL(value);
    const prefix = "/devtools/browser/";
    const id = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname)
      || Number(url.port) !== port || !BROWSER_ID.test(id)
      || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

async function browserDebuggerUrl(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(1000, Math.max(1, deadline - Date.now())));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
      const value = await response.json();
      const url = verifiedBrowserDebuggerUrl(value?.webSocketDebuggerUrl, port);
      if (!url) throw new Error("CDP browser endpoint is not loopback-bound");
      return url;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 75));
    } finally { clearTimeout(timer); }
  }
  throw lastError ?? new Error("CDP browser endpoint timed out");
}

class BrowserSession {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.closeListeners = new Set();
    this.closed = false;
  }

  async open() {
    if (typeof WebSocket !== "function") throw new Error("Node WebSocket support is required for live CDP");
    try {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(this.url);
        this.socket = socket;
        const timer = setTimeout(() => reject(new Error("CDP browser open timed out")), 5000);
        socket.addEventListener("open", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("CDP browser open failed"));
        }, { once: true });
        socket.addEventListener("message", (event) => this.#message(event));
        socket.addEventListener("close", () => this.close());
      });
    } catch (error) {
      this.close();
      throw error;
    }
    return this;
  }

  #message(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") for (const listener of this.listeners) {
      queueMicrotask(() => { try { listener(message); } catch {} });
    }
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (!this.socket || this.closed) return Promise.reject(new Error("CDP browser session is closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener) {
    if (this.closed) queueMicrotask(listener);
    else this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP browser session closed"));
    }
    this.pending.clear();
    try { socket?.close(); } catch {}
    for (const listener of this.closeListeners) queueMicrotask(listener);
    this.closeListeners.clear();
    this.listeners.clear();
  }
}

class CdpContents extends EventEmitter {
  constructor(target, port, onClosed) {
    super();
    this.target = target;
    this.port = port;
    this.onClosed = onClosed;
    this.session = new RendererSession(target, port);
    this.url = target.url;
    this.loading = false;
    this.destroyed = false;
    this.releases = [];
  }

  async start() {
    this.releases.push(this.session.onEvent((event) => this.#event(event)));
    this.releases.push(this.session.onClose(() => {
      this.destroy(false);
      this.onClosed?.();
    }));
    await this.session.open();
    await this.session.send("Page.enable");
    await this.session.send("Runtime.addBinding", { name: LIVE_ACTION_BINDING });
    return this;
  }

  #event(event) {
    if (event.method === "Runtime.bindingCalled"
      && event.params?.name === LIVE_ACTION_BINDING
      && typeof event.params.payload === "string") {
      this.emit("will-navigate", { preventDefault() {} }, event.params.payload);
      return;
    }
    if (event.method === "Page.frameNavigated" && !event.params?.frame?.parentId) {
      this.loading = true;
      this.url = String(event.params.frame.url ?? "");
      this.emit("did-start-navigation", {}, this.url, false, true);
      return;
    }
    if (event.method === "Page.navigatedWithinDocument") {
      this.url = String(event.params?.url ?? this.url);
      this.emit("did-start-navigation", {}, this.url, true, true);
      return;
    }
    if (event.method === "Runtime.executionContextsCleared") {
      this.loading = true;
      return;
    }
    if (event.method === "Page.loadEventFired") {
      this.loading = false;
      this.emit("dom-ready");
      this.emit("did-stop-loading");
    }
  }

  executeJavaScript(expression) { return this.session.evaluate(expression); }
  getType() { return "window"; }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  isLoadingMainFrame() { return this.loading; }

  destroy(closeSession = true) {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const release of this.releases.splice(0).reverse()) release();
    if (closeSession) this.session.close();
    this.emit("destroyed");
    this.removeAllListeners();
  }
}

function dispatch(controller, operation, params) {
  if (operation === "status") return controller.status();
  if (operation === "slot.mount") return controller.mount(params.slotId, params.artifact);
  if (operation === "slot.unmount") return controller.unmount(params.slotId);
  if (operation === "slot.diagnostics") return controller.diagnostics(params.slotId);
  if (operation === "recovery.set") return controller.setRecovery(params.slotId, params.artifact);
  if (operation === "recovery.clear") return controller.clearRecovery(params.slotId);
  if (operation === "ui.status") return controller.setUiStatus(params.status);
  throw new Error(`unsupported live CDP operation: ${operation}`);
}

class LiveCdpHost {
  constructor({ appPid, port }) {
    this.appPid = appPid;
    this.port = port;
    this.app = new EventEmitter();
    this.contents = new Map();
    this.controller = new LiveHostRenderer({
      app: this.app,
      webContents: { getAllWebContents: () => [...this.contents.values()] },
    });
    this.browser = null;
    this.actionListeners = new Set();
    this.refreshTail = Promise.resolve();
    this.closing = false;
    this.closed = new Promise((resolve) => { this.closedResolve = resolve; });
  }

  async start() {
    this.browser = await new BrowserSession(await browserDebuggerUrl(this.port)).open();
    this.browser.onEvent((event) => {
      if (event.method.startsWith("Target.")) this.queueRefresh();
    });
    this.browser.onClose(() => { void this.close(); });
    this.controller.start();
    this.controller.setActionHandler((action) => {
      if (!this.actionListeners.size) return false;
      for (const listener of this.actionListeners) {
        queueMicrotask(() => { try { listener({ action }); } catch {} });
      }
      return true;
    });
    await this.browser.send("Target.setDiscoverTargets", { discover: true });
    await this.queueRefresh();
    return this;
  }

  queueRefresh() {
    const next = this.refreshTail.then(() => this.refresh());
    this.refreshTail = next.catch(() => {});
    return next;
  }

  async refresh() {
    if (this.closing) return;
    const targets = await rendererTargets(this.port);
    const current = new Map(targets.map((target) => [target.id, target]));
    for (const [id, contents] of this.contents) {
      if (!current.has(id)) {
        this.contents.delete(id);
        contents.destroy();
      }
    }
    for (const [id, target] of current) {
      if (this.contents.has(id)) continue;
      try {
        const contents = await new CdpContents(target, this.port, () => {
          if (this.contents.get(id) === contents) this.contents.delete(id);
          this.queueRefresh();
        }).start();
        if (this.closing) contents.destroy();
        else {
          this.contents.set(id, contents);
          this.app.emit("web-contents-created", {}, contents);
        }
      } catch {
        if (!this.closing) setTimeout(() => this.queueRefresh(), 100).unref?.();
      }
    }
  }

  call(operation, params = {}) {
    if (this.closing) return Promise.reject(new Error("live CDP host is closed"));
    return Promise.resolve(dispatch(this.controller, operation, params));
  }

  onEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("live CDP event listener is required");
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  get host() { return { pid: this.appPid }; }

  async close() {
    if (this.closing) return;
    this.closing = true;
    this.controller.setActionHandler(null);
    this.actionListeners.clear();
    for (const contents of this.contents.values()) contents.destroy();
    this.contents.clear();
    await this.controller.close();
    this.browser?.close();
    this.closedResolve();
  }
}

export async function connectLiveCdpHost(options) {
  if (!Number.isSafeInteger(options?.appPid) || options.appPid < 2
    || !Number.isInteger(options?.port) || options.port < 1024 || options.port > 65535) {
    throw new Error("live CDP host identity is invalid");
  }
  return new LiveCdpHost(options).start();
}

export { LIVE_ACTION_BINDING, verifiedBrowserDebuggerUrl };
