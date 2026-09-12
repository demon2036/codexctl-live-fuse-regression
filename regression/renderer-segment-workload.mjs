import { openAppSession } from "./app-cdp.mjs";
import { chooseSidebarScroll } from "./sidebar-scroll.mjs";
import { benchmarkTargets } from "./renderer-benchmark-targets.mjs";
import { restoreBenchmarkComposer } from "./renderer-benchmark.mjs";

export const RENDERER_STREAM_PROFILE = Object.freeze({
  durationMs: 12_000,
  maxNodes: 960,
  nodesPerBatch: 4,
});
export const RENDERER_INPUT_PROFILE = Object.freeze({ repeats: 50, intervalMs: 8 });

const SETUP = `(() => {
  const { composer, sidebar } = (${benchmarkTargets.toString()})(${chooseSidebarScroll.toString()});
  if (!composer || !sidebar) return { ok: false };
  const sidebarRect = sidebar.getBoundingClientRect();
  window.__CODEXCTL_SEGMENT__ = {
    composer, sidebar,
    composerValue: "value" in composer ? composer.value : composer.textContent,
    scrollTop: sidebar.scrollTop,
    longTasks: [],
  };
  try {
    const observer = new PerformanceObserver((list) => {
      window.__CODEXCTL_SEGMENT__.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ type: "longtask" });
    window.__CODEXCTL_SEGMENT__.observer = observer;
  } catch {}
  composer.focus();
  return { ok: true, sidebar: { x: sidebarRect.x + sidebarRect.width / 2,
    y: sidebarRect.y + sidebarRect.height / 2 } };
})()`;

const STREAM = `(async () => {
  const host = document.createElement("div");
  host.id = "codexctl-stream-fixture";
  const surface = document.getElementById("messages")
    || document.querySelector(".thread-scroll-container")
    || document.querySelector("[data-app-shell-main-content-layout]");
  if (!surface) return false;
  surface.append(host);
  const deadline = performance.now() + ${RENDERER_STREAM_PROFILE.durationMs};
  let sequence = 0;
  while (performance.now() < deadline) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < ${RENDERER_STREAM_PROFILE.nodesPerBatch}; index += 1) {
      const node = document.createElement("span");
      node.textContent = String(sequence++);
      fragment.append(node);
    }
    host.append(fragment);
    while (host.childElementCount > ${RENDERER_STREAM_PROFILE.maxNodes}) {
      host.firstElementChild?.remove();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  host.remove();
  return true;
})()`;

const CLEANUP = `(() => {
  const data = window.__CODEXCTL_SEGMENT__;
  if (!data) return { longTasks: [], restored: false };
  data.sidebar.scrollTop = data.scrollTop;
  data.observer?.disconnect();
  const restored = String(("value" in data.composer
    ? data.composer.value : data.composer.textContent) || "")
    === String(data.composerValue || "") && data.sidebar.scrollTop === data.scrollTop
    && (window.__CODEXCTL_REGRESSION_APP__?.nativeDraft === undefined
      || window.__CODEXCTL_REGRESSION_APP__.nativeDraft === data.composerValue);
  const result = { longTasks: [...data.longTasks], restored };
  delete window.__CODEXCTL_SEGMENT__;
  return result;
})()`;

const INPUT_TOOLBAR_REACHABLE = `(() => {
  const editor = window.__CODEXCTL_SEGMENT__?.composer;
  const footer = editor?.closest('[data-composer-footer-responsive]');
  const permission = footer?.querySelector('[data-composer-navigation-target="permissions"]');
  if (!permission) return false;
  const rect = permission.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return rect.width > 0 && rect.height > 0 && permission.contains(hit);
})()`;

function metricMap(payload) {
  return Object.fromEntries((payload?.metrics ?? []).map(({ name, value }) => [name, value]));
}

function delta(before, after, name) {
  return Number((((after[name] ?? 0) - (before[name] ?? 0)) * 1000).toFixed(6));
}

export async function runRendererSegment(port, phase) {
  if (!new Set(["input", "scroll", "stream"]).has(phase)) {
    throw new Error(`Unknown renderer workload: ${phase}`);
  }
  const session = await openAppSession(port);
  let setup = null;
  try {
    setup = await session.evaluate(SETUP);
    if (!setup?.ok) throw new Error("Renderer segment targets were unavailable");
    await session.send("Performance.enable");
    const before = metricMap(await session.send("Performance.getMetrics"));
    if (phase === "input") {
      const text = "codexctl-segment-0123456789".repeat(RENDERER_INPUT_PROFILE.repeats);
      for (const character of text) {
        await session.send("Input.dispatchKeyEvent", { type: "char", text: character });
        await new Promise((resolve) => setTimeout(resolve, RENDERER_INPUT_PROFILE.intervalMs));
      }
    } else if (phase === "scroll") {
      for (let index = 0; index < 800; index += 1) {
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: setup.sidebar.x, y: setup.sidebar.y,
          deltaX: 0, deltaY: index % 2 === 0 ? 96 : -96,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } else await session.evaluate(STREAM, 20_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = metricMap(await session.send("Performance.getMetrics"));
    if (phase === "input" && !await session.evaluate(INPUT_TOOLBAR_REACHABLE)) {
      throw new Error("Renderer input displaced the native toolbar");
    }
    await restoreBenchmarkComposer(session);
    const cleanup = await session.evaluate(CLEANUP);
    if (!cleanup.restored) throw new Error("Renderer segment failed to restore state");
    return {
      layoutDurationMs: delta(before, after, "LayoutDuration"),
      longTaskCount: cleanup.longTasks.length,
      scriptDurationMs: delta(before, after, "ScriptDuration"),
      styleDurationMs: delta(before, after, "RecalcStyleDuration"),
      taskDurationMs: delta(before, after, "TaskDuration"),
    };
  } finally {
    if (setup) await restoreBenchmarkComposer(session).catch(() => {});
    if (setup) await session.evaluate(CLEANUP).catch(() => {});
    session.close();
  }
}
