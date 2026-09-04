import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ConfigError } from "./errors.mjs";
import { loadAvailableTheme } from "./themes.mjs";
import { writeTextIfChanged } from "./util.mjs";

const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const RUNTIME_IMAGES = /^(?:background|wallpaper)\.(?:png|jpe?g|webp)$/i;

async function validateImage(filename) {
  let canonical;
  try { canonical = await fs.realpath(filename); }
  catch (error) {
    if (error.code === "ENOENT") throw new ConfigError(`Wallpaper 文件不存在：${filename}`);
    throw error;
  }
  const stat = await fs.stat(canonical);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) {
    throw new ConfigError(`Wallpaper 必须是 1–${MAX_BYTES} bytes 的普通文件。`);
  }
  return { canonical, stat };
}

async function writeBytesIfChanged(filename, bytes) {
  const incoming = createHash("sha256").update(bytes).digest("hex");
  try {
    const current = await fs.readFile(filename);
    if (createHash("sha256").update(current).digest("hex") === incoming) return false;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, filename);
    await fs.chmod(filename, 0o600).catch(() => {});
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  return true;
}

async function cleanThemeDirectory(themeDir, activeImage, hasSafeCss) {
  for (const entry of await fs.readdir(themeDir, { withFileTypes: true })) {
    if (entry.isFile() && RUNTIME_IMAGES.test(entry.name) && entry.name !== activeImage) {
      await fs.rm(path.join(themeDir, entry.name), { force: true });
    }
  }
  if (!hasSafeCss) await fs.rm(path.join(themeDir, "theme.css"), { force: true });
}

function withOverrides(theme, overrides = {}) {
  const next = structuredClone(theme);
  if (overrides.appearance !== undefined) next.appearance = overrides.appearance;
  for (const key of ["focusX", "focusY", "safeArea", "taskMode"]) {
    if (overrides[key] !== undefined) next.art = { ...(next.art ?? {}), [key]: overrides[key] };
  }
  for (const key of ["overlayOpacity", "gradientBias", "sidebarOpacity", "composerOpacity"]) {
    if (overrides[key] !== undefined) next.tuning = { ...(next.tuning ?? {}), [key]: overrides[key] };
  }
  return next;
}

async function writeTheme(paths, theme, art, safeCss = "") {
  await writeBytesIfChanged(path.join(paths.themeDir, theme.image), art);
  if (safeCss) await writeTextIfChanged(path.join(paths.themeDir, "theme.css"), safeCss, 0o600);
  await writeTextIfChanged(path.join(paths.themeDir, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`, 0o600);
  await cleanThemeDirectory(paths.themeDir, theme.image, Boolean(safeCss));
}

async function materializeSelected(config, paths) {
  const loaded = await loadAvailableTheme(paths, config.wallpaper.themeId, config.wallpaper.themeSource);
  const theme = withOverrides(loaded.theme, config.wallpaper.overrides);
  await writeTheme(paths, theme, loaded.art, loaded.safeCss);
  return { enabled: true, source: loaded.source, themeId: theme.id, themeName: theme.name,
    image: loaded.imagePath, themeDir: paths.themeDir, bytes: loaded.art.length };
}

export async function materializeWallpaper(config, paths, options = {}) {
  const enabled = config.modules.wallpaper === true;
  if (!enabled && options.prepareDisabled !== true) {
    return { enabled: false, themeDir: paths.themeDir };
  }
  if (config.wallpaper.themeId) {
    const prepared = await materializeSelected(config, paths);
    return { ...prepared, enabled };
  }
  const { canonical, stat } = await validateImage(config.wallpaper.image);
  const extension = path.extname(canonical).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new ConfigError("Wallpaper 只支持 PNG、JPEG 和 WebP。");
  const theme = {
    schemaVersion: 1,
    id: "codexctl-wallpaper",
    name: "Codexctl Wallpaper",
    image: `wallpaper${extension}`,
    appearance: config.wallpaper.appearance,
    colors: {},
    art: {
      focusX: config.wallpaper.focusX,
      focusY: config.wallpaper.focusY,
      safeArea: config.wallpaper.safeArea,
      taskMode: config.wallpaper.taskMode,
    },
    tuning: {
      overlayOpacity: config.wallpaper.overlayOpacity,
      gradientBias: config.wallpaper.gradientBias,
      sidebarOpacity: config.wallpaper.sidebarOpacity,
      composerOpacity: config.wallpaper.composerOpacity,
    },
  };
  await writeTheme(paths, theme, await fs.readFile(canonical));
  return { enabled, source: "image", themeId: null, image: canonical,
    themeDir: paths.themeDir, bytes: stat.size };
}
