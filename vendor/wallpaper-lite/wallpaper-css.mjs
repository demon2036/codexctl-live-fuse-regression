function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function numberOr(value, fallback, minimum, maximum) {
  return clamp(Number.isFinite(value) ? value : fallback, minimum, maximum);
}

function rgba(value, opacity) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return value;
  const channel = (index) => Number.parseInt(match[index], 16);
  return `rgba(${channel(1)}, ${channel(2)}, ${channel(3)}, ${opacity.toFixed(3)})`;
}

export function optimizeWallpaperCss(value) {
  let css = String(value ?? "");
  if (css.includes(":has(")) throw new Error("Wallpaper CSS cannot contain :has()");
  css = css
    .replaceAll('[data-ds-part="root"]', 'html[data-codexctl-wallpaper="active"]')
    .replaceAll('[data-ds-part="sidebar"]', 'aside.app-shell-left-panel')
    .replaceAll(
      '[data-ds-part="composer"]',
      '.composer-surface-chrome, [data-composer-layout], [data-codex-composer-root]',
    )
    .replace(/backdrop-filter\s*:\s*(?!none\b)[^;}]+/gi, "backdrop-filter: none")
    .replace(/(^|[;{]\s*)filter\s*:\s*(?!none\b)[^;}]+/gim, "$1filter: none")
    .replace(/background-attachment\s*:\s*fixed\b/gi, "background-attachment: scroll");
  return Buffer.byteLength(css) <= 8192 && (css.match(/{/g) ?? []).length <= 32 ? css : "";
}

function palette(theme) {
  const { colors } = theme;
  const tuning = theme.tuning ?? {};
  const overlayOpacity = numberOr(tuning.overlayOpacity, 0.24, 0.02, 0.96);
  const gradientBias = numberOr(tuning.gradientBias, 0, -0.7, 0.7);
  const edgeOpacity = clamp(overlayOpacity + gradientBias / 2, 0.02, 0.96);
  const farOpacity = clamp(overlayOpacity - gradientBias / 2, 0.02, 0.96);
  const middleOpacity = edgeOpacity + (farOpacity - edgeOpacity) * 0.64;
  const sidebarOpacity = numberOr(tuning.sidebarOpacity, 0.52, 0.08, 0.96);
  const composerOpacity = numberOr(tuning.composerOpacity, 0.82, 0.45, 0.98);
  const surfaceOpacity = clamp(composerOpacity + 0.08, 0.53, 0.98);
  const elevatedOpacity = clamp(composerOpacity + 0.2, 0.65, 0.99);
  const underOpacity = clamp(composerOpacity + 0.14, 0.68, 0.98);
  const tint = tuning.tint ?? colors.background;
  return {
    composer: rgba(colors.panel, composerOpacity),
    edge: rgba(tint, edgeOpacity),
    far: rgba(tint, farOpacity),
    hover: rgba(colors.text, 0.1),
    middle: rgba(tint, middleOpacity),
    overlay: rgba(tint, overlayOpacity),
    sidebar: rgba(tint, sidebarOpacity),
    surface: rgba(colors.panelAlt, surfaceOpacity),
    surfaceElevated: rgba(colors.panelAlt, elevatedOpacity),
    surfaceSecondary: rgba(colors.panel, surfaceOpacity),
    surfaceUnder: rgba(colors.background, underOpacity),
    textSecondary: rgba(colors.text, 0.74),
    textTertiary: rgba(colors.text, 0.56),
  };
}

export function buildWallpaperCss(source) {
  const { colors } = source.theme;
  const paint = palette(source.theme);
  const appearance = source.theme.appearance === "light" ? "light" : "dark";
  return `
@layer codexctl-wallpaper-structure, dreamskin-community;
@layer codexctl-wallpaper-structure {
html[data-codexctl-wallpaper="active"] {
  --codexctl-wallpaper-border: ${colors.line};
  --codexctl-wallpaper-hover: ${paint.hover};
  --codexctl-wallpaper-panel: ${paint.composer};
  --codexctl-wallpaper-surface: ${paint.surface};
  --codexctl-wallpaper-surface-elevated: ${paint.surfaceElevated};
  --codexctl-wallpaper-surface-secondary: ${paint.surfaceSecondary};
  --codexctl-wallpaper-surface-under: ${paint.surfaceUnder};
  --codexctl-wallpaper-text: ${colors.text};
  --codexctl-wallpaper-text-secondary: ${paint.textSecondary};
  --codexctl-wallpaper-text-tertiary: ${paint.textTertiary};
  color-scheme: ${appearance};
  color: var(--codexctl-wallpaper-text) !important;
  background-color: ${colors.background} !important;
  background-image: linear-gradient(${paint.overlay}, ${paint.overlay}), var(--codexctl-wallpaper-art) !important;
  background-position: center, var(--codexctl-wallpaper-focus-x) var(--codexctl-wallpaper-focus-y) !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}
html[data-codexctl-wallpaper="active"] :is(body, #root) {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-codexctl-wallpaper="active"] :where(
  [data-app-shell-main-surface],
  [data-app-shell-main-content-layout],
  [data-app-shell-focus-area="main"],
  main.main-surface,
  .thread-scroll-container
) {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-codexctl-wallpaper="active"] [data-app-shell-main-surface] {
  background: linear-gradient(90deg, ${paint.edge}, ${paint.middle} 64%, ${paint.far}) !important;
}
html[data-codexctl-wallpaper="active"] [data-app-shell-main-surface] :is(
  .bg-token-main-surface-primary,
  .bg-token-main-surface-secondary
) {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel {
  background: linear-gradient(90deg, ${paint.sidebar}, ${paint.edge}) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel::after {
  background: transparent !important;
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel > div,
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel [data-app-action-sidebar-scroll] {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-codexctl-wallpaper="active"] :is(
  [data-app-shell-main-surface],
  aside.app-shell-left-panel,
  [data-codex-composer-root]
) {
  --color-text: var(--codexctl-wallpaper-text);
  --color-text-emphasis: var(--codexctl-wallpaper-text);
  --color-text-foreground: var(--codexctl-wallpaper-text);
  --color-text-foreground-secondary: var(--codexctl-wallpaper-text-secondary);
  --color-text-foreground-tertiary: var(--codexctl-wallpaper-text-tertiary);
  --color-text-secondary: var(--codexctl-wallpaper-text-secondary);
  --color-text-secondary-solid: var(--codexctl-wallpaper-text-secondary);
  --color-text-tertiary: var(--codexctl-wallpaper-text-tertiary);
  --color-icon-primary: var(--codexctl-wallpaper-text);
  --color-icon-secondary: var(--codexctl-wallpaper-text-secondary);
  --color-icon-tertiary: var(--codexctl-wallpaper-text-tertiary);
  --color-surface: var(--codexctl-wallpaper-surface);
  --color-surface-secondary: var(--codexctl-wallpaper-surface-secondary);
  --color-surface-tertiary: var(--codexctl-wallpaper-surface-elevated);
  --color-surface-elevated: var(--codexctl-wallpaper-surface-elevated);
  --color-surface-elevated-secondary: var(--codexctl-wallpaper-surface-elevated);
  --color-background-surface: var(--codexctl-wallpaper-surface);
  --color-background-surface-under: var(--codexctl-wallpaper-surface-under);
  --color-token-main-surface-primary: var(--codexctl-wallpaper-surface);
  --color-token-text-primary: var(--codexctl-wallpaper-text);
  --color-token-text-secondary: var(--codexctl-wallpaper-text-secondary);
  --color-token-text-tertiary: var(--codexctl-wallpaper-text-tertiary);
  --color-background-primary-ghost-hover: var(--codexctl-wallpaper-hover);
  --color-border: var(--codexctl-wallpaper-border);
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel :is(
  .text-default,
  .sidebar-item
) {
  --color-text: var(--codexctl-wallpaper-text) !important;
  color: var(--codexctl-wallpaper-text) !important;
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel .text-secondary {
  color: var(--codexctl-wallpaper-text-secondary) !important;
}
html[data-codexctl-wallpaper="active"] aside.app-shell-left-panel .text-tertiary {
  color: var(--codexctl-wallpaper-text-tertiary) !important;
}
html[data-codexctl-wallpaper="active"] :is(
  [data-app-shell-focus-area="bottom-panel"],
  [data-app-shell-focus-area="bottom-panel"] .bg-surface,
  [data-app-shell-main-content-layout] > .bg-surface
) {
  background: transparent !important;
}
html[data-codexctl-wallpaper="active"]
  .thread-scroll-container .bg-gradient-to-t.from-surface.via-surface {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-codexctl-wallpaper="active"] :is(
  [data-app-shell-header-edge-scroll],
  [data-app-shell-main-content-top-fade]
) {
  background-color: transparent !important;
}
html[data-codexctl-wallpaper="active"] [data-app-shell-main-content-top-fade] {
  background-image: linear-gradient(to bottom, ${paint.middle}, transparent) !important;
}
html[data-codexctl-wallpaper="active"] :is(
  .composer-surface-chrome,
  [data-composer-layout],
  [data-codex-composer-root]
) {
  background-color: ${paint.composer} !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
html[data-codexctl-wallpaper="active"] [data-codex-composer-root] {
  --color-background-composer-action-bar: var(--codexctl-wallpaper-panel);
}
html[data-codexctl-wallpaper="active"]
  [data-composer-rail-item][data-composer-rail-variant="controls"] {
  background: var(--codexctl-wallpaper-panel) !important;
  border-color: var(--codexctl-wallpaper-border) !important;
}
html[data-codexctl-wallpaper="active"] :is(
  .vertical-scroll-fade-mask,
  .horizontal-scroll-fade-mask,
  .loading-shimmer-pure-text,
  [class~="animate-spin"]
) {
  animation: none !important;
}
}
${optimizeWallpaperCss(source.safeCssRuntime)}`;
}
