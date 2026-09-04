import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { normalizeThemeColor, normalizeThemeText } from "../dream-skin/assets/theme-package-validator.mjs";
import { decodeAndValidateSafeCss } from "../dream-skin/assets/safe-css-validator.mjs";

const MAX_THEME_BYTES = 1024 * 1024;
const MAX_ART_BYTES = 10 * 1024 * 1024;
const MAX_SAFE_CSS_BYTES = 256 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative)
    && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function sameStat(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readStable(filename, maximumBytes, label, { optional = false } = {}) {
  let handle;
  try { handle = await fs.open(filename, OPEN_FLAGS); }
  catch (error) {
    if (optional && error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new Error(`${label} must be a non-empty regular file no larger than ${maximumBytes} bytes`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after) || bytes.length !== after.size) {
      throw new Error(`${label} changed while being read`);
    }
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

function choice(value, name, choices, source) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new Error(`${source} has an invalid ${name} field`);
  }
  return value;
}

function unit(value, name, source, { signed = false } = {}) {
  if (value === undefined) return undefined;
  const minimum = signed ? -1 : 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > 1) {
    throw new Error(`${source} has an invalid ${name} field`);
  }
  return value;
}

export function parseTheme(bytes, source) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(`${source} is not valid UTF-8`); }
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error(`${source} is not valid JSON`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || raw.schemaVersion !== 1 || typeof raw.image !== "string" || !raw.image
    || path.basename(raw.image) !== raw.image
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(raw.image)) {
    throw new Error(`${source} has an unsupported schema or image field`);
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(String(raw.id ?? ""))) {
    throw new Error(`${source} has an invalid id field`);
  }
  if (!/\.(?:png|jpe?g|webp)$/i.test(raw.image)) {
    throw new Error(`${source} has an unsupported image extension`);
  }
  const rawColors = raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors)
    ? raw.colors : null;
  const colorKeys = [
    "background", "panel", "panelAlt", "accent", "accentAlt", "secondary",
    "highlight", "text", "muted", "line",
  ];
  const rawArt = raw.art === undefined ? {} : raw.art;
  const rawTuning = raw.tuning === undefined ? {} : raw.tuning;
  if (!rawArt || typeof rawArt !== "object" || Array.isArray(rawArt)
    || !rawTuning || typeof rawTuning !== "object" || Array.isArray(rawTuning)) {
    throw new Error(`${source} has an invalid art or tuning field`);
  }
  const theme = {
    schemaVersion: 1,
    id: String(raw.id),
    name: normalizeThemeText(raw.name, "Codexctl Wallpaper", 80, "name", source),
    brandSubtitle: normalizeThemeText(raw.brandSubtitle, "CODEXCTL WALLPAPER", 120, "brandSubtitle", source),
    tagline: normalizeThemeText(raw.tagline, "Make something wonderful.", 160, "tagline", source),
    projectPrefix: normalizeThemeText(raw.projectPrefix, "选择项目 · ", 120, "projectPrefix", source),
    projectLabel: normalizeThemeText(raw.projectLabel, "◉  选择项目", 120, "projectLabel", source),
    statusText: normalizeThemeText(raw.statusText, "CODEXCTL ONLINE", 120, "statusText", source),
    quote: normalizeThemeText(raw.quote, "MAKE SOMETHING WONDERFUL", 120, "quote", source),
    image: raw.image,
    colorMode: rawColors ? "explicit" : "default",
    explicitColorKeys: rawColors ? colorKeys.filter((key) => Object.hasOwn(rawColors, key)) : [],
    colors: {
      background: normalizeThemeColor(rawColors?.background, "#071116"),
      panel: normalizeThemeColor(rawColors?.panel, "#0b1a20"),
      panelAlt: normalizeThemeColor(rawColors?.panelAlt, "#10272c"),
      accent: normalizeThemeColor(rawColors?.accent, "#7cff46"),
      accentAlt: normalizeThemeColor(rawColors?.accentAlt, "#b8ff3d"),
      secondary: normalizeThemeColor(rawColors?.secondary, "#36d7e8"),
      highlight: normalizeThemeColor(rawColors?.highlight, "#642a8c"),
      text: normalizeThemeColor(rawColors?.text, "#e9fff1"),
      muted: normalizeThemeColor(rawColors?.muted, "#9ebdb3"),
      line: normalizeThemeColor(rawColors?.line, "rgba(124, 255, 70, .28)"),
    },
  };
  const appearance = choice(raw.appearance, "appearance", ["auto", "light", "dark"], source);
  if (appearance !== undefined) theme.appearance = appearance;
  const art = {
    focusX: unit(rawArt.focusX, "art.focusX", source),
    focusY: unit(rawArt.focusY, "art.focusY", source),
    safeArea: choice(rawArt.safeArea, "art.safeArea", ["auto", "left", "right", "center", "none"], source),
    taskMode: choice(rawArt.taskMode, "art.taskMode", ["auto", "ambient", "banner", "full", "off"], source),
  };
  if (Object.values(art).some((value) => value !== undefined)) {
    theme.art = Object.fromEntries(Object.entries(art).filter(([, value]) => value !== undefined));
  }
  const tuning = {
    tint: rawTuning.tint === undefined
      ? undefined : normalizeThemeColor(rawTuning.tint, theme.colors.background),
    overlayOpacity: unit(rawTuning.overlayOpacity, "tuning.overlayOpacity", source),
    gradientBias: unit(rawTuning.gradientBias, "tuning.gradientBias", source, { signed: true }),
    sidebarOpacity: unit(rawTuning.sidebarOpacity, "tuning.sidebarOpacity", source),
    composerOpacity: unit(rawTuning.composerOpacity, "tuning.composerOpacity", source),
  };
  if (Object.values(tuning).some((value) => value !== undefined)) {
    theme.tuning = Object.fromEntries(Object.entries(tuning).filter(([, value]) => value !== undefined));
  }
  return theme;
}

export async function loadTheme(themeDir) {
  const requested = path.resolve(themeDir);
  const rootEntry = await fs.lstat(requested);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error("Theme root must be a real directory");
  }
  const root = await fs.realpath(requested);
  const configPath = path.join(root, "theme.json");
  const config = await readStable(configPath, MAX_THEME_BYTES, "Theme config");
  const theme = parseTheme(config.bytes, configPath);
  const imagePath = await fs.realpath(path.join(root, theme.image)).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`Theme image is missing: ${theme.image}`);
    throw error;
  });
  if (!contained(root, imagePath)) throw new Error("Theme image escaped its theme directory");
  const image = await readStable(imagePath, MAX_ART_BYTES, "Theme image");
  const safeCssFile = await readStable(
    path.join(root, "theme.css"),
    MAX_SAFE_CSS_BYTES,
    "Theme Safe CSS",
    { optional: true },
  );
  let safeCss = null;
  if (safeCssFile) safeCss = decodeAndValidateSafeCss(safeCssFile.bytes);
  return {
    art: image.bytes,
    assetsRoot: root,
    extension: path.extname(theme.image).toLowerCase(),
    imagePath,
    safeCss: safeCss?.source ?? "",
    safeCssRuntime: safeCss?.runtimeSource ?? "",
    safeCssPath: safeCssFile ? path.join(root, "theme.css") : null,
    safeCssStatus: safeCss ? "validated" : "none",
    theme,
  };
}
