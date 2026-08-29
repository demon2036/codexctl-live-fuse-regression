export const CONFIG_SCHEMA = "codexctl/1";

export const BUILTIN_CONTEXT_PRESETS = Object.freeze([
  Object.freeze({
    id: "native",
    label: "Native / Official",
    contextWindow: null,
    autoCompactTokenLimit: null,
    scope: null,
    builtin: true,
    native: true,
  }),
  Object.freeze({
    id: "oai",
    label: "Legacy OAI 272K",
    contextWindow: 272000,
    autoCompactTokenLimit: 244800,
    scope: "total",
    builtin: true,
  }),
  Object.freeze({
    id: "200k",
    label: "200K",
    contextWindow: 200000,
    autoCompactTokenLimit: 180000,
    scope: "total",
    builtin: true,
  }),
  Object.freeze({
    id: "300k",
    label: "300K",
    contextWindow: 300000,
    autoCompactTokenLimit: 270000,
    scope: "total",
    builtin: true,
  }),
  Object.freeze({
    id: "400k",
    label: "400K",
    contextWindow: 400000,
    autoCompactTokenLimit: 360000,
    scope: "total",
    builtin: true,
  }),
  Object.freeze({
    id: "450k",
    label: "450K",
    contextWindow: 450000,
    autoCompactTokenLimit: 400000,
    scope: "total",
    builtin: true,
  }),
]);

export function createDefaultConfig() {
  return {
    schema: CONFIG_SCHEMA,
    app: {
      path: null,
      cliPath: null,
      // Zero asks the launcher for a free loopback port per managed session.
      // Existing explicit ports remain supported for diagnostics.
      debugPort: 0,
      extraArgs: [],
      linuxDisplay: "auto",
    },
    modules: {
      // A pristine Codex launch is always the default.  Private Desktop
      // integration is opt-in per module; merely installing or upgrading
      // codexctl must never attach CDP or replace a running App instance.
      prompt: false,
      context: false,
      wallpaper: false,
    },
    prompt: {
      defaultProfileId: "default",
      selectionRevision: 0,
      profiles: [],
    },
    context: {
      defaultPresetId: "native",
      selectionRevision: 0,
      presets: BUILTIN_CONTEXT_PRESETS.map((preset) => ({ ...preset })),
    },
    wallpaper: {
      themeId: "yuugohan-tsuri",
      themeSource: "bundled",
      image: null,
      appearance: "dark",
      focusX: 0.5,
      focusY: 0.5,
      safeArea: "auto",
      taskMode: "auto",
      overlayOpacity: 0.42,
      gradientBias: 0,
      sidebarOpacity: 0.72,
      composerOpacity: 0.82,
      overrides: {},
    },
  };
}
