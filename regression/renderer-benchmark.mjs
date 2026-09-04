import { openAppSession } from "./app-cdp.mjs";
import { percentile } from "./ab-sampler.mjs";
import { chooseSidebarScroll } from "./sidebar-scroll.mjs";

function summary(values) {
  const finite = values.filter(Number.isFinite);
  return {
    samples: finite.length,
    p50Ms: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    maxMs: finite.length ? Math.max(...finite) : null,
    values: finite,
  };
}

const SETUP = `(() => {
  const chooseSidebarScroll = (${chooseSidebarScroll.toString()});
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden"
      && style.display !== "none";
  };
  const candidates = [...document.querySelectorAll(
    'textarea, [contenteditable="true"], [role="textbox"]'
  )];
  const composer = candidates.find((node) => visible(node) && node.closest(
    '[data-composer-layout], .composer-surface-chrome, [data-codex-composer="true"]'
  )) ?? candidates.find(visible) ?? null;
  const aside = document.querySelector('aside.app-shell-left-panel');
  const scrollables = [aside, ...(aside?.querySelectorAll('*') ?? [])].filter((node) => {
    if (!visible(node)) return false;
    const style = getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowY);
  });
  const sidebar = chooseSidebarScroll(scrollables);
  if (!composer) return { ok: false, reason: "composer-not-found" };
  const composerRect = composer.getBoundingClientRect();
  const sidebarRect = sidebar?.getBoundingClientRect() ?? null;
  composer.focus();
  window.__CODEXCTL_PERF_BENCH__?.cleanup?.();
  const data = {
    phase: "idle", input: [], scroll: [], longTasks: [], inputStart: null,
    composer, sidebar,
    originalComposerValue: "value" in composer ? composer.value : composer.textContent,
    originalScrollTop: sidebar?.scrollTop ?? null,
  };
  const beforeInput = () => {
    if (data.phase === "type") data.inputStart = performance.now();
  };
  const afterInput = () => {
    if (data.phase !== "type" || data.inputStart === null) return;
    const started = data.inputStart;
    requestAnimationFrame(() => data.input.push(performance.now() - started));
  };
  const onScroll = () => {
    if (data.phase !== "scroll") return;
    const started = performance.now();
    requestAnimationFrame(() => data.scroll.push(performance.now() - started));
  };
  document.addEventListener("beforeinput", beforeInput, true);
  document.addEventListener("input", afterInput, true);
  sidebar?.addEventListener("scroll", onScroll, { passive: true });
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) data.longTasks.push({
        duration: entry.duration, phase: data.phase, startTime: entry.startTime,
      });
    });
    observer.observe({ type: "longtask" });
  } catch {}
  data.cleanup = () => {
    document.removeEventListener("beforeinput", beforeInput, true);
    document.removeEventListener("input", afterInput, true);
    sidebar?.removeEventListener("scroll", onScroll);
    observer?.disconnect();
    if ("value" in composer) composer.value = data.originalComposerValue;
    else composer.textContent = data.originalComposerValue;
    if (sidebar && data.originalScrollTop !== null) sidebar.scrollTop = data.originalScrollTop;
  };
  window.__CODEXCTL_PERF_BENCH__ = data;
  return {
    ok: true,
    composer: { x: composerRect.x + composerRect.width / 2,
      y: composerRect.y + composerRect.height / 2 },
    sidebar: sidebarRect ? { x: sidebarRect.x + sidebarRect.width / 2,
      y: sidebarRect.y + sidebarRect.height / 2 } : null,
    wallpaper: Boolean(window.__CODEXCTL_WALLPAPER_V2__),
    promptContext: Boolean(window.__CODEX_BASE_PROMPT_SWITCHER__),
  };
})()`;

const COLLECT = `(() => {
  const data = window.__CODEXCTL_PERF_BENCH__;
  data.phase = "done";
  const result = {
    input: [...data.input], scroll: [...data.scroll], longTasks: [...data.longTasks],
    wallpaperMetrics: window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.().metrics ?? null,
    promptMetrics: window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.().uiMetrics ?? null,
  };
  data.cleanup();
  const restored = String(("value" in data.composer
    ? data.composer.value : data.composer.textContent) || "")
    === String(data.originalComposerValue || "")
    && (!data.sidebar || data.sidebar.scrollTop === data.originalScrollTop);
  delete window.__CODEXCTL_PERF_BENCH__;
  return { ...result, restored };
})()`;

function metricMap(payload) {
  return Object.fromEntries((payload?.metrics ?? []).map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name) {
  return Number((((after[name] ?? 0) - (before[name] ?? 0)) * 1000).toFixed(6));
}

async function alignToAnimationFrame(session) {
  await session.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve(true)))");
}

export async function runRendererBenchmark({
  inputOnly = false,
  label = "renderer",
  port,
  scrollSteps = 50,
  text = "codexctlperftest0123456789abcdefghij",
  typingIntervalMs = 25,
} = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid CDP port");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(label)) throw new Error("Invalid benchmark label");
  if (typeof text !== "string" || text.length < 10 || text.length > 200) {
    throw new Error("Invalid benchmark text");
  }
  const session = await openAppSession(port);
  let setup = null;
  try {
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    setup = await session.evaluate(SETUP);
    if (!setup?.ok) throw new Error(`Benchmark setup failed: ${setup?.reason ?? "unknown"}`);
    await session.send("Performance.enable");
    const beforeMetrics = await session.send("Performance.getMetrics");
    await session.evaluate(`window.__CODEXCTL_PERF_BENCH__.phase = "type"`);
    for (const character of text) {
      await alignToAnimationFrame(session);
      await session.send("Input.dispatchKeyEvent", { type: "char", text: character });
      if (typingIntervalMs) await new Promise((resolve) => setTimeout(resolve, typingIntervalMs));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (setup.sidebar && !inputOnly) {
      await session.evaluate(`window.__CODEXCTL_PERF_BENCH__.phase = "scroll"`);
      for (let index = 0; index < scrollSteps; index += 1) {
        await alignToAnimationFrame(session);
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: setup.sidebar.x, y: setup.sidebar.y,
          deltaX: 0, deltaY: index < scrollSteps / 2 ? 96 : -96,
        });
        if (typingIntervalMs) await new Promise((resolve) => setTimeout(resolve, typingIntervalMs));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const afterMetrics = await session.send("Performance.getMetrics");
    const result = await session.evaluate(COLLECT);
    if (result.input.length < Math.floor(text.length * 0.9)) {
      throw new Error(`Input benchmark captured ${result.input.length}/${text.length} events`);
    }
    if (!result.restored) throw new Error("Benchmark failed to restore composer/scroll state");
    if (setup.sidebar && !inputOnly && result.scroll.length < 5) {
      throw new Error(`Scroll benchmark captured only ${result.scroll.length} events`);
    }
    const before = metricMap(beforeMetrics);
    const after = metricMap(afterMetrics);
    const longTaskDurations = result.longTasks.map(({ duration }) => duration);
    return {
      input: summary(result.input),
      inputOnly,
      label,
      longTasks: summary(longTaskDurations),
      metricsAfter: { promptContext: result.promptMetrics, wallpaper: result.wallpaperMetrics },
      performance: {
        layoutDurationMs: metricDelta(before, after, "LayoutDuration"),
        recalcStyleDurationMs: metricDelta(before, after, "RecalcStyleDuration"),
        scriptDurationMs: metricDelta(before, after, "ScriptDuration"),
        taskDurationMs: metricDelta(before, after, "TaskDuration"),
      },
      restored: result.restored,
      scroll: summary(result.scroll),
      setup,
      targetId: session.target.id,
    };
  } finally {
    if (setup) await session.evaluate(`window.__CODEXCTL_PERF_BENCH__?.cleanup?.();
      delete window.__CODEXCTL_PERF_BENCH__;`).catch(() => {});
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
    session.close();
  }
}
