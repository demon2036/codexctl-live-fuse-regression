export const MAX_SAFE_CSS_BYTES = 256 * 1024;
export const MAX_RULES = 128;
export const MAX_DECLARATIONS = 512;
export const MAX_VALUE_CHARACTERS = 512;
export const RUNTIME_CASCADE_LAYER = "dreamskin-community";
export const CORE_BACKGROUND_IMAGE_PARTS = new Set(["sidebar", "main", "home"]);

export const SAFE_CSS_PARTS = Object.freeze([
  "root",
  "sidebar",
  "main",
  "header",
  "home",
  "home-hero",
  "project-list",
  "thread",
  "message",
  "composer",
  "composer-toolbar",
  "dialog",
]);

export const SAFE_CSS_VARIABLES = Object.freeze([
  "--ds-theme-color-background",
  "--ds-theme-color-panel",
  "--ds-theme-color-panel-alt",
  "--ds-theme-color-accent",
  "--ds-theme-color-accent-alt",
  "--ds-theme-color-secondary",
  "--ds-theme-color-highlight",
  "--ds-theme-color-text",
  "--ds-theme-color-muted",
  "--ds-theme-color-line",
  "--ds-theme-font-family",
  "--ds-theme-font-scale",
  "--ds-theme-surface-opacity",
  "--ds-theme-surface-blur",
  "--ds-theme-surface-radius",
  "--ds-theme-surface-border-alpha",
  "--ds-theme-surface-shadow",
  "--ds-theme-image-focus-x",
  "--ds-theme-image-focus-y",
  "--ds-theme-image-zoom",
  "--ds-theme-image-dim",
  "--ds-theme-image-task-intensity",
  "--ds-theme-density-scale",
  "--ds-theme-motion-level",
]);

export const COLOR_VARIABLES = new Set(SAFE_CSS_VARIABLES.filter((name) => name.includes("-color-")));
export const PARTS = new Set(SAFE_CSS_PARTS);
export const VARIABLES = new Set(SAFE_CSS_VARIABLES);
export const SAFE_CSS_STATES = Object.freeze(["hover", "focus-visible"]);
export const STATES = new Set(SAFE_CSS_STATES);
export const COLOR_PROPERTIES = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
]);
export const WIDTH_PROPERTIES = new Set([
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
]);
export const STYLE_PROPERTIES = new Set([
  "border-style",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
]);
export const RADIUS_PROPERTIES = new Set([
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
]);
export const SPACING_PROPERTIES = new Set(["gap", "row-gap", "column-gap"]);
export const TRANSITION_TARGETS = new Set([
  ...COLOR_PROPERTIES,
  ...WIDTH_PROPERTIES,
  ...RADIUS_PROPERTIES,
  ...SPACING_PROPERTIES,
  "box-shadow",
  "opacity",
  "backdrop-filter",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
]);
export const SAFE_PROPERTIES = new Set([
  ...TRANSITION_TARGETS,
  ...STYLE_PROPERTIES,
  "font-family",
  "transition-duration",
  "transition-property",
]);
export const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
export const NUMBER = "(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?|0?\\.[0-9]+";
export const SIGNED_NUMBER = `-?(?:${NUMBER})`;
export const HEX_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]|[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i;
export const SIMPLE_SELECTOR = /^\[data-ds-part="([a-z]+(?:-[a-z]+)*)"\](?::([a-z-]+))?$/;
export const PROPERTY_NAME = /^[a-z][a-z-]*$/;
export const VAR_FUNCTION = /^var\(\s*(--[a-z0-9-]+)\s*\)$/;
export const FILTER_FUNCTION = /^(blur|saturate|brightness|contrast)\(\s*(.+?)\s*\)$/i;
export const SAFE_WHITESPACE = new Set(["\t", "\n", "\r", "\f", " "]);

export class SafeCssValidationError extends Error {
  constructor(code, message, line, column) {
    super(`${message} (${line}:${column})`);
    this.name = "SafeCssValidationError";
    this.code = code;
    this.line = line;
    this.column = column;
  }
}
