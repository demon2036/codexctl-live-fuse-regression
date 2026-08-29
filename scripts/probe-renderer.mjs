#!/usr/bin/env node

const port = Number(process.argv[2] ?? 9342);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`Invalid port: ${port}`);
}
if (typeof WebSocket !== "function") {
  throw new Error("WebSocket is unavailable; run Node 20 with --experimental-websocket");
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(async (response) => {
  if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
  return response.json();
});

function validatedTarget(target) {
  if (target?.type !== "page" || !target?.url?.startsWith("app://")
    || !/^[A-Za-z0-9._-]{1,220}$/.test(target?.id ?? "")) return null;
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || Number(url.port) !== port || url.pathname !== `/devtools/page/${target.id}`
    || url.username || url.password || url.search || url.hash) return null;
  return url.href;
}

async function evaluate(target, expression) {
  const debuggerUrl = validatedTarget(target);
  if (!debuggerUrl) return null;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(debuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out: ${target.id}`));
    }, 5000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description
          ?? message.result.exceptionDetails.text));
      } else {
        resolve(message.result?.result?.value ?? null);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP connection failed: ${target.id}`));
    });
  });
}

const expression = `(() => {
  const controller = window.__CODEX_BASE_PROMPT_SWITCHER__;
  const root = document.documentElement;
  const summarizeStyle = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      selector,
      tag: node.tagName,
      className: typeof node.className === "string" ? node.className : "",
      disabled: "disabled" in node ? Boolean(node.disabled) : null,
      ariaDisabled: node.getAttribute?.("aria-disabled"),
      text: selector.includes("data-codex-") || selector === ".cbps-menu"
        ? node.textContent?.trim().replace(/\\s+/g, " ").slice(0, 180) || ""
        : null,
      color: style.color,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      width: Number(rect.width.toFixed(1)),
      height: Number(rect.height.toFixed(1)),
      ancestors: Array.from({ length: 4 }, (_, index) => {
        let ancestor = node.parentElement;
        for (let level = 0; level < index && ancestor; level += 1) ancestor = ancestor.parentElement;
        if (!ancestor) return null;
        const ancestorStyle = getComputedStyle(ancestor);
        return {
          tag: ancestor.tagName,
          className: typeof ancestor.className === "string" ? ancestor.className : "",
          opacity: ancestorStyle.opacity,
          color: ancestorStyle.color,
        };
      }).filter(Boolean),
    };
  };
  const rootStyle = getComputedStyle(root);
  const wallpaperV2State = window.__CODEXCTL_WALLPAPER_V2__;
  const wallpaperLegacyState = window.__CODEX_DREAM_SKIN_STATE__;
  const wallpaperState = wallpaperV2State ?? wallpaperLegacyState;
  const wallpaperDiagnostics = wallpaperV2State?.diagnostics?.() ?? (wallpaperLegacyState ? {
    installed: true,
    version: wallpaperLegacyState.version ?? null,
    revision: wallpaperLegacyState.revision ?? null,
    themeId: wallpaperLegacyState.themeId ?? "custom",
    engine: "dream-skin-1.5.11",
    appearance: wallpaperLegacyState.appearance ?? "system",
    artReady: root.getAttribute("data-dream-art-ready") === "true",
    artUrl: wallpaperLegacyState.artUrl ?? null,
    artMetadata: wallpaperLegacyState.artMetadata ?? null,
    rootAttribute: root.getAttribute("data-dream-skin") === "active" ? "on" : null,
    partCount: document.querySelectorAll("[data-ds-part]").length,
    scope: wallpaperLegacyState.scope ?? null,
    metrics: wallpaperLegacyState.metrics ? { ...wallpaperLegacyState.metrics } : null,
  } : null);
  return {
    url: location.href,
    preview: controller?.previewTransform({
      threadSource: "user",
      baseInstructions: "official-placeholder",
      config: { preserve_me: "yes" },
    }) ?? null,
    diagnostics: controller?.diagnostics() ?? null,
    wallpaper: {
      active: root.getAttribute("data-codexctl-wallpaper")
        ?? root.getAttribute("data-dream-skin"),
      themeId: root.getAttribute("data-codexctl-wallpaper-theme")
        ?? wallpaperLegacyState?.themeId ?? null,
      rootClass: root.className,
      statePresent: Boolean(wallpaperState),
      diagnostics: wallpaperDiagnostics,
      metrics: wallpaperState?.metrics ? { ...wallpaperState.metrics } : null,
      variables: {
        text: rootStyle.getPropertyValue("--ds-theme-color-text").trim(),
        muted: rootStyle.getPropertyValue("--ds-theme-color-muted").trim(),
        panel: rootStyle.getPropertyValue("--ds-theme-color-panel").trim(),
        nativeTextSecondary: rootStyle.getPropertyValue("--text-secondary").trim(),
      },
      elements: {
        body: summarizeStyle("body"),
        sidebar: summarizeStyle("aside.app-shell-left-panel"),
        main: summarizeStyle("main"),
        composer: summarizeStyle('[data-ds-part="composer"]'),
        permission: summarizeStyle('[data-composer-navigation-target="permissions"]'),
        prompt: summarizeStyle('[data-codex-base-prompt-trigger="true"]'),
        context: summarizeStyle('[data-codex-context-window-trigger="true"]'),
        menu: summarizeStyle(".cbps-menu"),
      },
    },
  };
})()`;

const results = [];
for (const target of targets) {
  const debuggerUrl = validatedTarget(target);
  if (!debuggerUrl) continue;
  results.push({ targetId: target.id, value: await evaluate(target, expression) });
}
console.log(JSON.stringify({ port, results }, null, 2));
