import { createHash } from "node:crypto";
import { RendererSession, rendererTargets } from "../src/renderer-injection.mjs";
import { chooseSidebarScroll } from "./sidebar-scroll.mjs";
import { classifyPaintStyle, effectivePaintBackground } from "./visual-paint.mjs";

export function classifyPlatformShell(text, interactive = false) {
  if (interactive) return "interactive";
  const normalized = String(text ?? "").toLowerCase().replaceAll("’", "'");
  if (normalized.includes("don't have access to codex")) return "access-restricted";
  if (/sign in with chatgpt|log in to chatgpt|sign in to codex/.test(normalized)) {
    return "authentication-required";
  }
  if (/open (?:a )?folder|choose a folder|select (?:a )?(?:folder|project)/.test(normalized)) {
    return "workspace-required";
  }
  if (/codex is still starting|rebuilding conversation history/.test(normalized)) return "loading";
  return "unknown";
}

export function platformShellInteractive({ composerRoot, editor, main, sidebar, sidebarScroll } = {}) {
  return Boolean(editor && composerRoot && sidebar && main && sidebarScroll);
}

export function classifyBottomLayers(layers = []) {
  if (layers.includes("opaque-black")) return "opaque-black";
  if (layers.includes("theme")) return "theme";
  if (layers.length && layers.every((value) => value === "transparent")) return "transparent";
  return layers.find((value) => value !== "missing") ?? "missing";
}

const PROBE = `(() => {
  const classifyBottomLayers = (${classifyBottomLayers.toString()});
  const classifyPaintStyle = (${classifyPaintStyle.toString()});
  const effectivePaintBackground = (${effectivePaintBackground.toString()});
  const platformShellInteractive = (${platformShellInteractive.toString()});
  const chooseSidebarScroll = (${chooseSidebarScroll.toString()});
  const bounds = (node) => {
    const rect = node?.getBoundingClientRect?.();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      right: rect.right, bottom: rect.bottom } : null;
  };
  const visible = (node) => {
    const rect = bounds(node);
    const style = node ? getComputedStyle(node) : null;
    return Boolean(rect && rect.width > 1 && rect.height > 1 && style.display !== "none"
      && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05);
  };
  const background = (node, pseudo = null) => {
    if (!node) return "missing";
    return effectivePaintBackground(
      getComputedStyle(node),
      pseudo ? getComputedStyle(node, pseudo) : null,
      { missing: "missing" },
    );
  };
  const region = (node, pseudo = null) => ({ background: background(node, pseudo), bounds: bounds(node),
    visible: visible(node) });
  const editors = [...document.querySelectorAll(
    'textarea, [contenteditable="true"], [role="textbox"]'
  )].filter(visible);
  const editor = editors.find((node) => node.closest(
    '[data-composer-layout], .composer-surface-chrome, [data-codex-composer="true"]'
  )) || editors[0] || null;
  const composer = editor?.closest(
    '.composer-surface-chrome, [data-composer-layout], [data-codex-composer="true"]'
  ) || editor;
  const composerRoot = editor?.closest('[data-codex-composer-root]') || composer;
  const sidebar = [...document.querySelectorAll('aside.app-shell-left-panel')].find(visible) || null;
  const main = [...document.querySelectorAll('[data-app-shell-main-surface]')].find(visible) || null;
  const bottomPanel = [...document.querySelectorAll('[data-app-shell-focus-area="bottom-panel"]')]
    .find(visible) || null;
  const scrollables = [sidebar, ...(sidebar?.querySelectorAll('*') || [])].filter((node) => {
    if (!visible(node)) return false;
    const style = getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowY);
  });
  const scroll = chooseSidebarScroll(scrollables);
  const control = (selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    return { count: nodes.length, bounds: bounds(nodes[0]), reachable: visible(nodes[0]) };
  };
  const prompt = window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() || null;
  const wallpaper = window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() || null;
  const nodeKind = (node) => node ? {
    tag: node.tagName, role: node.getAttribute("role"),
    modal: node.getAttribute("aria-modal"),
    target: node.getAttribute("data-composer-navigation-target"),
    composer: node.hasAttribute("data-codex-composer"),
    footer: node.hasAttribute("data-composer-footer-responsive"),
  } : null;
  const ownerEvidence = [...document.querySelectorAll(
    '[data-codex-composer], [data-composer-navigation-target="permissions"]'
  )].slice(0, 12).map((node) => {
    const rect = bounds(node);
    const hit = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { ...nodeKind(node), bounds: rect, visible: visible(node),
      composerValue: node.getAttribute("data-codex-composer"),
      footerAncestor: Boolean(node.closest('[data-composer-footer-responsive]')),
      hit: nodeKind(hit), hitInside: Boolean(hit && node.contains(hit)) };
  });
  const sidebarBounds = bounds(sidebar);
  const mainBounds = bounds(main);
  const bottom = (() => {
    if (!mainBounds || mainBounds.width <= 1 || mainBounds.height <= 1) {
      return { background: "missing", bounds: null, visible: false };
    }
    const height = Math.min(24, mainBounds.height);
    const strip = { x: mainBounds.x, y: mainBounds.bottom - height,
      width: mainBounds.width, height, right: mainBounds.right, bottom: mainBounds.bottom };
    const sampleX = Math.min(innerWidth - 2, Math.max(1, mainBounds.x + mainBounds.width / 2));
    const sampleY = Math.min(innerHeight - 2, Math.max(1, mainBounds.bottom - 2));
    const hit = document.elementFromPoint(sampleX, sampleY);
    if (!hit || !main?.contains(hit)) return { background: "missing", bounds: strip, visible: false };
    const layers = [];
    for (let node = hit; node && node !== main; node = node.parentElement) {
      layers.push(background(node, "::before"));
    }
    return { background: layers.length ? classifyBottomLayers(layers) : "transparent",
      bounds: strip, visible: true };
  })();
  const fades = [...document.querySelectorAll(
    '.thread-scroll-container .bg-gradient-to-t.from-surface.via-surface'
  )].filter(visible).map((node) => region(node));
  const interactive = platformShellInteractive({ composerRoot, editor, main, sidebar,
    sidebarScroll: scroll });
  return {
    url: location.href,
    interactive,
    shellState: (${classifyPlatformShell.toString()})(document.body?.innerText, interactive),
    draftEmpty: !editor || String(("value" in editor ? editor.value : editor.textContent) || "").length === 0,
    regions: {
      wallpaper: region(document.documentElement), body: region(document.body),
      bottom, sidebar: region(sidebar), main: region(main),
      composer: region(composerRoot, "::before"),
    },
    sidebarDocked: Boolean(sidebarBounds && mainBounds
      && sidebarBounds.right <= mainBounds.x + 0.5
      && sidebar?.parentElement === main?.parentElement
      && !["absolute", "fixed"].includes(getComputedStyle(sidebar).position)),
    controls: {
      prompt: control('[data-codex-base-prompt-trigger="true"]'),
      context: control('[data-codex-context-window-trigger="true"]'),
    },
    diagnostics: {
      controlContextAvailable: prompt?.controlContextAvailable ?? null,
      controlHostHidden: prompt?.controlHostHidden ?? null,
      controlLayout: prompt?.controlLayout ?? null,
      controlObservers: prompt?.controlObservers ?? null,
      managerStatus: prompt?.managerStatus || null,
      promptRevision: prompt?.revision || null,
      contextRevision: prompt?.features?.context ? prompt.revision : null,
      terminalPanelVisible: visible(bottomPanel),
      wallpaperRevision: wallpaper?.revision || null,
    },
    ownerEvidence,
    sidebarScroll: { bounds: bounds(scroll), candidateCount: scrollables.length,
      clientHeight: scroll?.clientHeight ?? null, found: Boolean(scroll),
      overflowing: Boolean(scroll && scroll.scrollHeight > scroll.clientHeight + 1),
      scrollHeight: scroll?.scrollHeight ?? null,
      hit: (() => {
        const rect = bounds(scroll);
        const hit = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { node: nodeKind(hit), inside: Boolean(hit && scroll.contains(hit)) };
      })() },
    metrics: {
      observerCount: wallpaper?.metrics?.observers || 0,
      timerCount: (wallpaper?.metrics?.timers || 0)
        + Object.values(prompt?.activeTimers || {}).reduce((sum, value) => sum + value, 0),
      workerCount: 0,
      layoutReads: wallpaper?.metrics?.layoutReads || 0,
      reconciles: wallpaper?.metrics?.reconciles || 0,
    },
    installation: {
      promptGlobal: Boolean(window.__CODEX_BASE_PROMPT_SWITCHER__),
      wallpaperGlobal: Boolean(window.__CODEXCTL_WALLPAPER_V2__),
      promptStyles: document.querySelectorAll('#codex-base-prompt-switcher-style').length,
      wallpaperStyles: document.querySelectorAll('#codexctl-wallpaper-v2-style').length,
    },
    fades,
    viewport: { width: innerWidth, height: innerHeight },
  };
})()`;

function unique(values) {
  return [...new Set(values)];
}

export async function collectPlatformRendererEvidence(port, { captureScreenshot = true } = {}) {
  const targets = await rendererTargets(port);
  const target = targets.find(({ url }) => url === "app://-/index.html") ?? targets[0];
  if (!target) return { reasonCodes: ["renderer-target-missing"], status: "unverified" };
  const session = new RendererSession(target, port);
  try {
    await session.open();
    const value = await session.evaluate(PROBE);
    let screenshot = null;
    if (captureScreenshot) {
      const clip = { x: Math.max(0, value.viewport.width - 64),
        y: Math.max(0, value.viewport.height - 64), width: 64, height: 64, scale: 1 };
      const shot = await session.send("Page.captureScreenshot", {
        captureBeyondViewport: false, clip, format: "png", fromSurface: true,
      });
      const bytes = Buffer.from(shot.data, "base64");
      screenshot = {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
    return {
      ...value,
      screenshot,
      status: value.interactive ? "pass" : "unverified",
      reasonCodes: value.interactive ? [] : ["interactive-shell-unavailable"],
      target: { id: target.id, url: target.url },
    };
  } finally {
    session.close();
  }
}

export function evaluatePlatformRendererEvidence({ mode, value } = {}) {
  if (value?.status === "unverified") {
    return { failures: [], reasonCodes: value.reasonCodes, status: "unverified" };
  }
  const failures = [];
  const fail = (condition, code) => { if (condition) failures.push(code); };
  fail(value?.status !== "pass" || value?.interactive !== true, "interactive-shell");
  fail(value?.sidebarScroll?.found !== true, "sessions-scroll-missing");
  fail(value?.sidebarScroll?.overflowing !== true, "sessions-not-scrollable");
  fail(!Number.isFinite(value?.screenshot?.bytes) || value.screenshot.bytes < 100, "screenshot");
  if (mode === "official") {
    fail(Object.values(value?.installation ?? {}).some((entry) => Boolean(entry)),
      "official-injection-residue");
  } else {
    for (const name of ["wallpaper", "sidebar", "main", "composer"]) {
      fail(value?.regions?.[name]?.background !== "theme", `${name}-not-themed`);
    }
    fail(value?.regions?.bottom?.background !== "transparent", "bottom-not-transparent");
    fail(value?.sidebarDocked !== true, "sidebar-overlap");
    for (const name of ["prompt", "context"]) {
      fail(value?.controls?.[name]?.count !== 1, `${name}-count`);
      fail(value?.controls?.[name]?.reachable !== true, `${name}-unreachable`);
    }
    fail(value?.diagnostics?.managerStatus !== "ready", "manager-not-ready");
    for (const name of ["promptRevision", "contextRevision", "wallpaperRevision"]) {
      fail(!/^[0-9a-f]{24}$/.test(value?.diagnostics?.[name] ?? ""), `${name}-invalid`);
    }
    fail(Object.values(value?.metrics ?? {}).some((entry) => entry !== 0), "steady-work");
    fail(value?.fades?.some(({ background }) => background === "opaque-black"), "bottom-fade-black");
  }
  const reasonCodes = unique(failures).sort();
  return { failures: reasonCodes, reasonCodes, status: reasonCodes.length ? "fail" : "pass" };
}
