((css, artUrl, theme, version, styleRevision, revision) => {
  "use strict";

  const STATE_KEY = "__CODEXCTL_WALLPAPER_V2__";
  const STYLE_ID = "codexctl-wallpaper-v2-style";
  const ROOT_ATTRIBUTES = [
    "data-codexctl-wallpaper",
    "data-codexctl-wallpaper-theme",
    "data-codexctl-wallpaper-task-mode",
    "data-dream-skin",
    "data-dream-art-ready",
  ];
  const ROOT_PROPERTIES = [
    "--codexctl-wallpaper-art",
    "--codexctl-wallpaper-focus-x",
    "--codexctl-wallpaper-focus-y",
  ];

  const previous = window[STATE_KEY];
  if (previous?.revision === revision) return previous.diagnostics();
  try { previous?.cleanup?.(); } catch {}

  const root = document.documentElement;
  if (!root) throw new Error("Wallpaper requires documentElement");
  const originalAppearance = root.classList.contains("electron-dark") ? "dark"
    : root.classList.contains("electron-light") ? "light" : null;
  if (theme.appearance === "dark" || theme.appearance === "light") {
    root.classList.remove("electron-dark", "electron-light");
    root.classList.add(`electron-${theme.appearance}`);
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  (document.head || root).appendChild(style);

  root.setAttribute("data-codexctl-wallpaper", "active");
  root.setAttribute("data-codexctl-wallpaper-theme", theme.id || "custom");
  root.setAttribute("data-codexctl-wallpaper-task-mode", theme.art?.taskMode || "auto");
  root.setAttribute("data-dream-skin", "active");
  root.setAttribute("data-dream-art-ready", "true");
  root.style.setProperty("--codexctl-wallpaper-art", `url("${artUrl}")`);
  root.style.setProperty("--codexctl-wallpaper-focus-x", `${(theme.art?.focusX ?? 0.5) * 100}%`);
  root.style.setProperty("--codexctl-wallpaper-focus-y", `${(theme.art?.focusY ?? 0.5) * 100}%`);

  let stopped = false;
  const metrics = Object.freeze({
    installs: 1,
    observers: 0,
    timers: 0,
    mutationBatches: 0,
    mutationRecords: 0,
    layoutReads: 0,
    reconciles: 0,
    styleRules: (css.match(/{/g) || []).length,
    cssBytes: css.length,
  });

  const cleanup = () => {
    if (stopped) return false;
    stopped = true;
    for (const attribute of ROOT_ATTRIBUTES) root.removeAttribute(attribute);
    for (const property of ROOT_PROPERTIES) root.style.removeProperty(property);
    if (theme.appearance === "dark" || theme.appearance === "light") {
      root.classList.remove("electron-dark", "electron-light");
      if (originalAppearance) root.classList.add(`electron-${originalAppearance}`);
    }
    if (document.getElementById(STYLE_ID) === style) style.remove();
    const blobs = window.__CODEXCTL_WALLPAPER_V2_BLOBS__;
    const record = blobs?.[revision];
    if (record?.url === artUrl) {
      delete blobs[revision];
      try { URL.revokeObjectURL(artUrl); } catch {}
    }
    if (window[STATE_KEY] === state) delete window[STATE_KEY];
    return true;
  };

  const diagnostics = () => ({
    installed: !stopped,
    version,
    revision,
    styleRevision,
    themeId: theme.id || "custom",
    engine: "codexctl-wallpaper-once/4",
    performanceProfile: "one-shot-compositor",
    appearance: theme.appearance || "system",
    artReady: !stopped && root.getAttribute("data-dream-art-ready") === "true",
    artUrl,
    artMetadata: theme.artMetadata || null,
    rootAttribute: root.getAttribute("data-dream-skin") === "active" ? "on" : null,
    partCount: 0,
    scope: { state: "global", baseState: "global", overlay: false, level: "L1", missingL1: [] },
    stylePresent: document.getElementById(STYLE_ID) === style,
    metrics,
  });

  const state = {
    version,
    revision,
    styleRevision,
    themeId: theme.id || "custom",
    appearance: theme.appearance || "system",
    artUrl,
    artMetadata: theme.artMetadata || null,
    metrics,
    cleanup,
    diagnostics,
  };
  window[STATE_KEY] = state;
  return diagnostics();
})(
  __DREAM_SKIN_CSS_JSON__,
  __DREAM_SKIN_ART_JSON__,
  __DREAM_SKIN_THEME_JSON__,
  __DREAM_SKIN_VERSION_JSON__,
  __DREAM_SKIN_STYLE_REVISION_JSON__,
  __DREAM_SKIN_PAYLOAD_REVISION_JSON__
)
