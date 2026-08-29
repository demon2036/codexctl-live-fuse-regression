import fs from "node:fs/promises";
import path from "node:path";
import { RendererSession, rendererTargets } from "../src/renderer-injection.mjs";
import { waitForCodexCdp } from "../src/cdp.mjs";
import { classifyPaintStyle, effectivePaintBackground } from "./visual-paint.mjs";

export async function openAppSession(port, timeoutMs = 10_000) {
  const readiness = await waitForCodexCdp(port, timeoutMs);
  if (!readiness.reachable) throw new Error(`App CDP target unavailable: ${readiness.detail}`);
  const target = (await rendererTargets(port)).find(({ url }) => url === "app://-/index.html");
  if (!target) throw new Error("Owned App fixture target was not found");
  const session = new RendererSession(target, port);
  await session.open();
  return session;
}

export async function withAppSession(port, operation) {
  const session = await openAppSession(port);
  try { return await operation(session); }
  finally { session.close(); }
}

export function injectedModulesReady(value, modules) {
  const controlsEnabled = modules.context || modules.prompt;
  return value?.context === Number(modules.context)
    && value?.prompt === Number(modules.prompt)
    && (!controlsEnabled || value?.manager === "ready")
    && value?.wallpaper === Boolean(modules.wallpaper);
}

export async function waitForInjectedModules(port, modules, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return withAppSession(port, async (session) => {
    let last = null;
    while (Date.now() < deadline) {
      last = await session.evaluate(`(() => {
        const api = window.__CODEX_BASE_PROMPT_SWITCHER__;
        const diagnostics = api?.diagnostics?.() ?? null;
        return {
          context: document.querySelectorAll('[data-codex-context-window-trigger="true"]').length,
          manager: diagnostics?.managerStatus ?? null,
          managerProbe: diagnostics?.managerProbe ?? null,
          prompt: document.querySelectorAll('[data-codex-base-prompt-trigger="true"]').length,
          wallpaper: Boolean(window.__CODEXCTL_WALLPAPER_V2__),
        };
      })()`);
      if (injectedModulesReady(last, modules)) return last;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Injected modules were not ready: ${JSON.stringify(last)}`);
  });
}

export async function waitForInjectedControls(port, timeoutMs = 5000) {
  return waitForInjectedModules(port, {
    context: true, prompt: true, wallpaper: false,
  }, timeoutMs);
}

const VISUAL_EXPRESSION = `(() => {
  const classifyPaintStyle = (${classifyPaintStyle.toString()});
  const effectivePaintBackground = (${effectivePaintBackground.toString()});
  const bounds = (node) => {
    if (!node) return { height: 0, width: 0, x: 0, y: 0 };
    const value = node.getBoundingClientRect();
    return { height: value.height, width: value.width, x: value.x, y: value.y };
  };
  const classify = (node, pseudo = null) => {
    if (!node) return "other";
    return effectivePaintBackground(
      getComputedStyle(node),
      pseudo ? getComputedStyle(node, pseudo) : null,
    );
  };
  const region = (node, pseudo = null) => ({ background: classify(node, pseudo), bounds: bounds(node),
    visible: Boolean(node && bounds(node).height > 1 && bounds(node).width > 1) });
  const html = document.documentElement;
  const sidebar = document.getElementById("sidebar");
  const main = document.getElementById("main");
  const sidebarBounds = bounds(sidebar);
  const mainBounds = bounds(main);
  return {
    regions: {
      wallpaper: region(html),
      bottom: region(document.getElementById("bottom")),
      sidebar: region(sidebar),
      main: region(main),
      composer: region(document.getElementById("composer"), "::before"),
    },
    sidebarDocked: sidebarBounds.width > 1 && sidebarBounds.x + sidebarBounds.width <= mainBounds.x + 0.5,
    sidebarMainGap: mainBounds.x - sidebarBounds.x - sidebarBounds.width,
    wallpaperVisibleMs: window.__CODEXCTL_REGRESSION_APP__?.wallpaperVisibleMs ?? 0,
  };
})()`;

const CONTROL_EXPRESSION = `(() => {
  const host = document.getElementById("codex-prompt-context-control-host");
  const permission = document.querySelector('[data-codexctl-control-anchor="true"]')
    ?? [...document.querySelectorAll('[data-composer-navigation-target="permissions"]')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      });
  const hostRect = host?.getBoundingClientRect();
  const permissionRect = permission?.getBoundingClientRect();
  const anchored = Boolean(hostRect && permissionRect
    && Math.abs(hostRect.left - permissionRect.right - 5) < 1
    && Math.abs(hostRect.top - permissionRect.top) < 1
    && hostRect.left >= 0 && hostRect.right <= innerWidth
    && hostRect.top >= 0 && hostRect.bottom <= innerHeight);
  const value = (selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    const node = nodes[0];
    const rect = node?.getBoundingClientRect();
    return {
      bounds: rect ? { height: rect.height, width: rect.width, x: rect.x, y: rect.y }
        : { height: 0, width: 0, x: 0, y: 0 },
      count: nodes.length,
      reachable: Boolean(anchored && node && rect.width > 1 && rect.height > 1
        && getComputedStyle(node).visibility !== "hidden" && (() => {
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit === node || Boolean(hit && node.contains(hit));
        })()),
    };
  };
  return {
    context: value('[data-codex-context-window-trigger="true"]'),
    prompt: value('[data-codex-base-prompt-trigger="true"]'),
  };
})()`;

const METRIC_EXPRESSION = `(() => {
  const prompt = window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() ?? null;
  const wallpaper = window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null;
  const fixture = window.__CODEXCTL_REGRESSION_APP__;
  const activeTimers = Object.values(prompt?.activeTimers ?? {}).reduce((sum, value) => sum + value, 0);
  return {
    cpuMedian: 0,
    cpuP95: 0,
    inputMaxMs: fixture?.interaction?.inputMaxMs ?? 0,
    inputP95Ms: fixture?.interaction?.inputP95Ms ?? 0,
    layoutReads: wallpaper?.metrics?.layoutReads ?? 0,
    longTaskCount: fixture?.interaction?.longTaskCount ?? 0,
    observerCount: (wallpaper?.metrics?.observers ?? 0)
      + (fixture?.counters?.mutationObservers ?? 0) + (fixture?.counters?.resizeObservers ?? 0),
    scrollMaxMs: fixture?.interaction?.scrollMaxMs ?? 0,
    scrollP95Ms: fixture?.interaction?.scrollP95Ms ?? 0,
    timerCount: (wallpaper?.metrics?.timers ?? 0) + activeTimers
      + (fixture?.counters?.intervals ?? 0),
    workerCount: fixture?.counters?.workers ?? 0,
  };
})()`;

export function probeVisual(port) {
  return withAppSession(port, (session) => session.evaluate(VISUAL_EXPRESSION));
}

export function probeControls(port) {
  return withAppSession(port, (session) => session.evaluate(CONTROL_EXPRESSION));
}

export function probeMetrics(port) {
  return withAppSession(port, (session) => session.evaluate(METRIC_EXPRESSION));
}

export function probeRemote(port) {
  return withAppSession(port, (session) => session.evaluate(
    `window.__CODEXCTL_REGRESSION_APP__?.remote ?? { errors: ["fixture-missing"], status: "disconnected" }`,
  ));
}

export function probeDiagnostics(port) {
  return withAppSession(port, (session) => session.evaluate(`(() => {
    const prompt = window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() ?? null;
    const wallpaper = window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null;
    return {
      contextRevision: prompt?.features?.context ? prompt.revision : null,
      promptRevision: prompt?.features?.prompt ? prompt.revision : null,
      wallpaperRevision: wallpaper?.revision ?? null,
    };
  })()`));
}

export function probeInstallationDetails(port) {
  return withAppSession(port, (session) => session.evaluate(`(() => {
    const prompt = window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() ?? null;
    const wallpaper = window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null;
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? {
        bottom: value.bottom, height: value.height, left: value.left,
        right: value.right, top: value.top, width: value.width,
      } : null;
    };
    const host = document.getElementById('codex-prompt-context-control-host');
    return {
      globals: {
        prompt: Boolean(window.__CODEX_BASE_PROMPT_SWITCHER__),
        wallpaper: Boolean(window.__CODEXCTL_WALLPAPER_V2__),
      },
      hostCount: document.querySelectorAll('#codex-prompt-context-control-host').length,
      controlLayout: {
        host: rect(host),
        permission: rect([...document.querySelectorAll(
          '[data-composer-navigation-target="permissions"]',
        )].find((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 1 && bounds.height > 1;
        })),
        controls: [...(host?.children ?? [])].map((node) => {
          const prefix = node.querySelector('.cbps-label-prefix');
          const value = node.querySelector('.cbps-label-value');
          return {
            bounds: rect(node),
            className: node.className,
            lineHeight: getComputedStyle(node).lineHeight,
            prefixDisplay: prefix ? getComputedStyle(prefix).display : null,
            text: node.textContent,
            valueFits: value ? value.clientWidth + 0.5 >= value.scrollWidth : null,
          };
        }),
      },
      promptStyleCount: document.querySelectorAll('#codex-base-prompt-switcher-style').length,
      wallpaperStyleCount: document.querySelectorAll('#codexctl-wallpaper-v2-style').length,
      promptRevision: prompt?.revision ?? null,
      wallpaperRevision: wallpaper?.revision ?? null,
      activeTimers: prompt?.activeTimers ?? null,
      wallpaperMetrics: wallpaper?.metrics ?? null,
      fixtureCounters: window.__CODEXCTL_REGRESSION_APP__?.counters ?? null,
    };
  })()`));
}

export async function markWallpaperVisible(port, durationMs) {
  return withAppSession(port, (session) => session.evaluate(
    `window.__CODEXCTL_REGRESSION_APP__.wallpaperVisibleMs = ${Number(durationMs)}`,
  ));
}

export async function captureRedactedScreenshot(port, filename) {
  if (!path.isAbsolute(filename)) throw new Error("Screenshot target must be absolute");
  return withAppSession(port, async (session) => {
    const result = await session.send(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true },
      20_000,
    );
    if (!/^[A-Za-z0-9+/=]+$/.test(result?.data ?? "")) throw new Error("Invalid screenshot data");
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.writeFile(filename, Buffer.from(result.data, "base64"), { mode: 0o600 });
    return { bytes: Buffer.byteLength(result.data, "base64"), name: path.basename(filename) };
  });
}
