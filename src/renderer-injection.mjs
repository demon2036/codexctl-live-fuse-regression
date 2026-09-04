const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TARGET_ID = /^[A-Za-z0-9._-]{1,220}$/;

export function verifiedRendererDebuggerUrl(target, port) {
  if (target?.type !== "page" || !TARGET_ID.test(target?.id ?? "")
    || !target?.url?.startsWith("app://")) return null;
  try {
    if (new URL(target.url).searchParams.get("initialRoute") === "/avatar-overlay") return null;
    const url = new URL(target.webSocketDebuggerUrl);
    if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname)
      || Number(url.port) !== port || url.pathname !== `/devtools/page/${target.id}`
      || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export class RendererSession {
  constructor(target, port) {
    this.target = target;
    this.url = verifiedRendererDebuggerUrl(target, port);
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async open() {
    if (!this.url) throw new Error("Rejected non-loopback renderer target");
    try {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(this.url);
        const timeout = setTimeout(() => reject(new Error("CDP open timed out")), 5000);
        socket.addEventListener("open", () => {
          clearTimeout(timeout);
          this.socket = socket;
          resolve();
        }, { once: true });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("CDP open failed"));
        }, { once: true });
        socket.addEventListener("message", (event) => this.#message(event));
        socket.addEventListener("close", () => this.close());
      });
      await this.send("Runtime.enable");
      return this;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  #message(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (!this.socket) return Promise.reject(new Error("CDP session is closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 10_000) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text ?? "Renderer evaluation failed");
    }
    return result.result?.value;
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("CDP session closed"));
    }
    this.pending.clear();
    try { socket?.close(); } catch {}
  }
}

export async function rendererTargets(port, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
    const targets = await response.json();
    return targets.filter((target) => verifiedRendererDebuggerUrl(target, port));
  } finally { clearTimeout(timeout); }
}

export async function withRendererSessions(port, operation) {
  const targets = await rendererTargets(port);
  if (!targets.length) throw new Error("No primary ChatGPT renderer target");
  const results = [];
  for (const target of targets) {
    const session = new RendererSession(target, port);
    try {
      await session.open();
      results.push({ targetId: target.id, value: await operation(session, target) });
    } finally { session.close(); }
  }
  return results;
}
