import fs from "node:fs/promises";
import path from "node:path";
import { loadPayload } from "../vendor/wallpaper-lite/injector.mjs";

export async function loadControlCss(projectRoot) {
  const source = await fs.readFile(path.join(
    projectRoot,
    "vendor",
    "prompt-context",
    "renderer",
    "45-control-style.part.js",
  ), "utf8");
  const tick = String.fromCharCode(96);
  const token = `style.textContent = ${tick}`;
  const start = source.indexOf(token);
  const end = source.indexOf(`${tick};`, start + token.length);
  if (start < 0 || end < 0) throw new Error("Prompt control CSS template not found");
  return source.slice(start + token.length, end);
}

export async function loadWallpaperFixturePayload(projectRoot, { fault = null } = {}) {
  const loaded = await loadPayload(path.join(
    projectRoot,
    "assets",
    "wallpapers",
    "yuugohan-tsuri",
  ), { artUrl: "blob:codexctl-pending" });
  const payload = fault === "bottom-selector"
    ? loaded.payload.replaceAll(
      'data-app-shell-focus-area=\\"bottom-panel\\"',
      'data-app-shell-focus-area=\\"missing-panel\\"',
    )
    : loaded.payload;
  return { ...loaded, payload };
}

function encoded(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

export function wallpaperFixtureHtml({ controlCss, wallpaperPayload }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; }
#root { display: flex; flex-direction: column; }
#shell { display: flex; flex: 1 1 auto; min-height: 100vh; }
#docked-sidebar { flex: 0 0 280px; min-width: 0; background: rgb(17,17,17); }
#docked-main { flex: 1 1 0%; min-width: 0; background: rgb(17,17,17); }
#layout { display: flex; flex-direction: column; min-height: 100%; }
#messages { flex: 1 1 auto; min-height: 20px; background: rgb(17,17,17); }
#bottom, #bottom-surface { min-height: 24px; background: rgb(17,17,17); }
#composer { min-height: 42px; background: rgb(17,17,17); }
#permission { position: absolute; left: 180px; top: 120px; width: 90px; height: 32px; }
#control-host { width: 160px; height: 28px; left: 1px; top: 2px; }
#floating-sidebar, #floating-inner { background: rgb(17,17,17); }
#floating-sidebar { position: absolute; visibility: hidden; width: 280px; }
.thread-scroll-container .bg-gradient-to-t.from-surface.via-surface {
  background-image: linear-gradient(to top, #111 0%, #111 50%, transparent 100%);
}
${controlCss}
</style></head><body><div id="root">
<button id="permission">Permissions</button>
<div id="control-host" class="cbps-control-host">Default · Native</div>
<div id="shell"><aside id="docked-sidebar" class="app-shell-left-panel">
<div id="sidebar-scroll" data-app-action-sidebar-scroll></div></aside>
<section id="docked-main" data-app-shell-main-surface>
<main id="layout" data-app-shell-main-content-layout>
<div id="messages" class="thread-scroll-container bg-surface">
<div id="thread-bottom-fade" class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface via-surface"></div>
</div>
<div id="bottom" data-app-shell-focus-area="bottom-panel">
<div id="bottom-surface" class="bg-surface">
<div id="composer" class="composer-surface-chrome" data-composer-layout contenteditable="true"></div>
</div></div></main></section></div>
<aside id="floating-sidebar" data-testid="app-shell-floating-left-panel">
<div id="floating-inner"></div></aside>
<pre id="result"></pre></div>
<script>
(() => {
  const source = new TextDecoder().decode(Uint8Array.from(
    atob(${JSON.stringify(encoded(wallpaperPayload))}), (value) => value.charCodeAt(0)
  ));
  const artUrl = URL.createObjectURL(new Blob([new Uint8Array([82,73,70,70])], { type: "image/webp" }));
  window.eval(source.replace(JSON.stringify("blob:codexctl-pending"), JSON.stringify(artUrl)));
  const node = (id) => document.getElementById(id);
  const style = (id, pseudo = null) => getComputedStyle(node(id), pseudo);
  const rect = (id) => {
    const value = node(id).getBoundingClientRect();
    return { left: value.left, right: value.right, width: value.width, height: value.height,
      top: value.top, bottom: value.bottom };
  };
  const surfaceState = (label) => ({
    label,
    viewport: { width: innerWidth, height: innerHeight },
    layoutViewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    documentWidth: document.documentElement.scrollWidth,
    scrollbarGutter: innerWidth - document.documentElement.clientWidth,
    documentHeight: document.documentElement.scrollHeight,
    htmlMinHeight: getComputedStyle(document.documentElement).minHeight,
    bodyMinHeight: getComputedStyle(document.body).minHeight,
    rootMinHeight: style("root").minHeight,
    htmlIsolation: getComputedStyle(document.documentElement).isolation,
    rootIsolation: style("root").isolation,
    htmlBackground: getComputedStyle(document.documentElement).backgroundImage,
    htmlPosition: getComputedStyle(document.documentElement).backgroundPosition,
    planeBackground: getComputedStyle(document.documentElement, "::before").backgroundImage,
    planeContain: getComputedStyle(document.documentElement, "::before").contain,
    planeHeight: getComputedStyle(document.documentElement, "::before").height,
    planePosition: getComputedStyle(document.documentElement, "::before").backgroundPosition,
    planePositionType: getComputedStyle(document.documentElement, "::before").position,
    planeWidth: getComputedStyle(document.documentElement, "::before").width,
    rootAttribute: document.documentElement.getAttribute("data-codexctl-wallpaper"),
    mainBackground: style("docked-main").backgroundColor,
    mainImage: style("docked-main").backgroundImage,
    bottomBackground: style("bottom").backgroundColor,
    bottomImage: style("bottom").backgroundImage,
    bottomSurfaceBackground: style("bottom-surface").backgroundColor,
    composerBackground: style("composer").backgroundColor,
    composerPlaneBackground: getComputedStyle(node("composer"), "::before").backgroundColor,
    composerPlaneContain: getComputedStyle(node("composer"), "::before").contain,
    sidebarBackground: style("docked-sidebar").backgroundImage,
    sidebarContain: style("docked-sidebar").contain,
    sidebarWillChange: style("docked-sidebar").willChange,
    threadFadeImage: style("thread-bottom-fade").backgroundImage,
    threadContain: style("messages").contain,
    composerContain: style("composer").contain,
  });
  const short = surfaceState("short");
  node("messages").style.minHeight = "1400px";
  const long = surfaceState("long");
  node("messages").style.minHeight = "20px";
  node("composer").style.height = "180px";
  const multiline = surfaceState("multiline");
  node("composer").style.height = "";

  const sidebar = node("docked-sidebar");
  const main = node("docked-main");
  sidebar.style.flexBasis = "0px";
  const collapsedMain = rect("docked-main");
  sidebar.style.flexBasis = "280px";
  const expandedSidebar = rect("docked-sidebar");
  const expandedMain = rect("docked-main");
  const anchor = node("permission");
  const host = node("control-host");
  const positionHost = () => {
    const anchorRect = anchor.getBoundingClientRect();
    host.style.left = Math.round(anchorRect.left + anchorRect.width + 5) + "px";
    host.style.top = Math.round(anchorRect.top) + "px";
  };
  positionHost();
  const firstAnchor = rect("control-host");
  anchor.style.top = "260px";
  positionHost();
  const secondAnchor = rect("control-host");

  const before = window.__CODEXCTL_WALLPAPER_V2__.diagnostics().metrics;
  for (let index = 0; index < 1000; index += 1) {
    node("composer").dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: "a" }));
    node("composer").dispatchEvent(new InputEvent("input", { bubbles: true, data: "a" }));
  }
  for (let index = 0; index < 100; index += 1) {
    node("sidebar-scroll").dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 96 }));
  }
  const stream = document.createDocumentFragment();
  for (let index = 0; index < 300; index += 1) stream.append(document.createElement("span"));
  node("messages").append(stream);
  const after = window.__CODEXCTL_WALLPAPER_V2__.diagnostics().metrics;
  const delta = Object.fromEntries(["observers", "timers", "layoutReads", "reconciles",
    "mutationBatches", "mutationRecords"].map((key) => (
    [key, (after[key] || 0) - (before[key] || 0)]
  )));
  // Recreate a docked host with a changed tag/class and another wrapper layer.
  const updatedSidebar = document.createElement("section");
  updatedSidebar.id = sidebar.id;
  updatedSidebar.setAttribute("data-app-shell-left-panel-appearance", "default");
  updatedSidebar.innerHTML = '<div><div data-app-action-sidebar-scroll></div></div>';
  sidebar.replaceWith(updatedSidebar);
  const compatibleSidebar = {
    image: getComputedStyle(updatedSidebar).backgroundImage,
    scrollBackground: getComputedStyle(updatedSidebar.querySelector('[data-app-action-sidebar-scroll]')).backgroundColor,
    right: updatedSidebar.getBoundingClientRect().right,
    mainLeft: rect("docked-main").left,
  };
  const wallpaperStyle = node("codexctl-wallpaper-v2-style").textContent;
  node("result").textContent = JSON.stringify({
    anchorSupported: CSS.supports("left: anchor(right)"),
    anchor: { first: firstAnchor, second: secondAnchor },
    nativeAnchorAttribute: anchor.getAttribute("data-codexctl-control-anchor"),
    hostPointerEvents: getComputedStyle(host).pointerEvents,
    diagnostics: window.__CODEXCTL_WALLPAPER_V2__.diagnostics(),
    states: [short, long, multiline],
    stressDelta: delta,
    forbiddenCss: /:has\\(|backdrop-filter:\\s*blur|filter:\\s+(?:blur|contrast|brightness|drop-shadow)|position:\\s*fixed|background-attachment:\\s*fixed|animation:\\s+(?!none\\b)[a-z]/i.test(wallpaperStyle),
    sidebarLayout: { collapsedMain, expandedMain, expandedSidebar },
    compatibleSidebar,
    floating: { background: style("floating-sidebar").backgroundColor,
      image: style("floating-sidebar").backgroundImage,
      innerBackground: style("floating-inner").backgroundColor,
      selectorThemed: wallpaperStyle.includes("app-shell-floating-left-panel") },
  });
})();
</script></body></html>`;
}
