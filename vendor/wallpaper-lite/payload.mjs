import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { readImageMetadata } from "../dream-skin/scripts/image-metadata.mjs";
import { loadTheme } from "./theme-loader.mjs";
import { buildWallpaperCss } from "./wallpaper-css.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = "codexctl-wallpaper-once/4";
const PROFILE = "one-shot-compositor";

export { optimizeWallpaperCss } from "./wallpaper-css.mjs";

function mimeFor(extension) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function loadSource(themeDir) {
  const [template, versionText, loaded] = await Promise.all([
    fs.readFile(path.join(here, "renderer.js"), "utf8"),
    fs.readFile(path.join(here, "VERSION"), "utf8"),
    loadTheme(themeDir),
  ]);
  const artMetadata = readImageMetadata(loaded.art, loaded.extension);
  if (!artMetadata) throw new Error("Wallpaper image metadata is invalid");
  const artHash = createHash("sha256").update(loaded.art).digest("hex");
  const version = versionText.trim();
  const sourceRevision = createHash("sha256").update(version).update(template)
    .update(JSON.stringify(loaded.theme)).update(loaded.safeCssRuntime).update(artHash)
    .digest("hex").slice(0, 24);
  return { ...loaded, artHash, artMetadata, mime: mimeFor(loaded.extension), sourceRevision, template, version };
}

export function compileSource(source, artUrl) {
  const imageBytes = source.imageBytes ?? source.art?.length;
  if (!Number.isSafeInteger(imageBytes) || imageBytes < 1) {
    throw new Error("Wallpaper source image size is invalid");
  }
  const css = buildWallpaperCss(source);
  const styleRevision = createHash("sha256").update(css).digest("hex").slice(0, 20);
  const revision = createHash("sha256").update(source.sourceRevision).update(styleRevision)
    .update(ENGINE).update(PROFILE).digest("hex").slice(0, 24);
  const theme = { ...source.theme, artMetadata: source.artMetadata, artKey: source.artHash.slice(0, 20) };
  const replacements = {
    __DREAM_SKIN_CSS_JSON__: css,
    __DREAM_SKIN_ART_JSON__: artUrl,
    __DREAM_SKIN_THEME_JSON__: theme,
    __DREAM_SKIN_VERSION_JSON__: source.version,
    __DREAM_SKIN_STYLE_REVISION_JSON__: styleRevision,
    __DREAM_SKIN_PAYLOAD_REVISION_JSON__: revision,
  };
  let payload = source.template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    payload = payload.replace(placeholder, () => JSON.stringify(value));
  }
  if (/__DREAM_SKIN_[A-Z0-9_]+_JSON__/.test(payload)) throw new Error("Wallpaper placeholder remained");
  new Script(payload, { filename: "codexctl-wallpaper-renderer.js" });
  return {
    art: source.art ?? null,
    artHash: source.artHash,
    artMetadata: source.artMetadata,
    config: { engine: ENGINE, performanceProfile: PROFILE, revision, artUrl },
    imageBytes,
    mime: source.mime,
    payload,
    revision,
    safeCssStatus: source.safeCssStatus,
    source,
    theme: source.theme,
  };
}

export async function loadPayload(themeDir, options = {}) {
  const source = await loadSource(themeDir);
  return compileSource(source, options.artUrl ?? "blob:codexctl-pending");
}
