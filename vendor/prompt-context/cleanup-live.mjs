#!/usr/bin/env node

const options = { port: 9342, timeoutMs: 5000 };
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--port") options.port = Number(process.argv[++index]);
  else if (arg === "--timeout-ms") options.timeoutMs = Number(process.argv[++index]);
  else throw new Error(`Unknown argument: ${arg}`);
}
if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
  throw new Error(`Invalid port: ${options.port}`);
}
if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 30000) {
  throw new Error(`Invalid timeout: ${options.timeoutMs}`);
}

const endpoint = `http://127.0.0.1:${options.port}/json/list`;
let targets = [];
try {
  targets = await fetch(endpoint).then((response) => {
    if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
    return response.json();
  });
} catch (error) {
  console.log(JSON.stringify({ cleanedTargets: 0, results: [], unavailable: error.message }, null, 2));
  process.exit(0);
}

const appTargets = targets.filter((target) => {
  if (target?.type !== "page" || typeof target?.id !== "string"
    || !/^[A-Za-z0-9._-]{1,220}$/.test(target.id)
    || typeof target?.url !== "string" || !target.url.startsWith("app://")
    || typeof target?.webSocketDebuggerUrl !== "string") return false;
  try {
    if (new URL(target.url).searchParams.get("initialRoute") === "/avatar-overlay") {
      return false;
    }
    const url = new URL(target.webSocketDebuggerUrl);
    return url.protocol === "ws:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && Number(url.port) === options.port
      && url.pathname === `/devtools/page/${target.id}`
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
});

const expression = String.raw`(() => {
  const STATE_KEY = "__CODEX_BASE_PROMPT_SWITCHER__";
  const PATCH_KEY = "__CODEX_BASE_PROMPT_REQUEST_PATCH_V1__";
  const api = window[STATE_KEY];
  if (api && typeof api.cleanup === "function") {
    try {
      api.cleanup();
      try { delete window[STATE_KEY]; } catch {}
      return {
        mode: "controller",
        managers: 0,
        restoredClients: 1,
        statePresent: Boolean(window[STATE_KEY]),
        promptButtons: document.querySelectorAll('[data-codex-base-prompt-trigger="true"]').length,
        contextButtons: document.querySelectorAll('[data-codex-context-window-trigger="true"]').length,
      };
    } catch {}
  }

  // Crash recovery only: the controller normally restores its own request
  // client immediately. Keep the fallback graph scan tightly bounded.
  const roots = [];
  for (const node of document.querySelectorAll("*")) {
    for (const key of Object.keys(node)) {
      if (key.startsWith("__reactFiber$")) roots.push(node[key]);
    }
    if (roots.length >= 56) break;
  }

  const queue = [...roots];
  const seen = new WeakSet();
  const managers = new Set();
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length && visited < 20000) {
    const value = queue[cursor++];
    if ((typeof value !== "object" && typeof value !== "function") || value === null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    try {
      if (Object.prototype.hasOwnProperty.call(value, "hostId") && value.hostId === "local"
        && Object.prototype.hasOwnProperty.call(value, "requestClient")
        && value.requestClient) {
        managers.add(value);
      }
    } catch {}
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { continue; }
    for (const descriptor of Object.values(descriptors)) {
      if (!("value" in descriptor)) continue;
      const child = descriptor.value;
      if ((typeof child !== "object" && typeof child !== "function") || child === null) continue;
      if (child === window || child === document || child instanceof Node) continue;
      queue.push(child);
    }
  }

  let restoredClients = 0;
  for (const manager of managers) {
    const client = manager.requestClient;
    const patch = client?.[PATCH_KEY];
    if (!patch || typeof patch !== "object") continue;
    if (typeof patch.originalSendRequest === "function") {
      client.sendRequest = patch.originalSendRequest;
    }
    if (typeof patch.originalPrewarmThreadStart === "function") {
      client.prewarmThreadStart = patch.originalPrewarmThreadStart;
    }
    try { delete client[PATCH_KEY]; } catch {}
    restoredClients += 1;
  }

  if (api && typeof api.cleanup === "function") try { api.cleanup(); } catch {}
  try { delete window[STATE_KEY]; } catch {}

  return {
    managers: managers.size,
    restoredClients,
    statePresent: Boolean(window[STATE_KEY]),
    promptButtons: document.querySelectorAll('[data-codex-base-prompt-trigger="true"]').length,
    contextButtons: document.querySelectorAll('[data-codex-context-window-trigger="true"]').length,
  };
})()`;

const evaluate = (target) => new Promise((resolve, reject) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error(`Timed out cleaning target ${target.id}`));
  }, options.timeoutMs);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timeout);
    socket.close();
    const exception = message.result?.exceptionDetails;
    if (exception) {
      reject(new Error(exception.exception?.description || exception.text || "CDP evaluation failed"));
      return;
    }
    resolve({
      targetId: target.id,
      url: target.url,
      result: message.result?.result?.value ?? null,
    });
  });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error(`CDP connection failed for target ${target.id}`));
  });
});

const results = await Promise.all(appTargets.map((target) => evaluate(target)));
console.log(JSON.stringify({ cleanedTargets: results.length, results }, null, 2));
