import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodeAndValidateSafeCss } from "../vendor/dream-skin/assets/safe-css-validator.mjs";
import { compileSource } from "../vendor/wallpaper-lite/payload.mjs";
import { parseTheme } from "../vendor/wallpaper-lite/theme-loader.mjs";
import { readLiveImageMetadata } from "./live-image-metadata.mjs";
import { assertLivePrivateFile, ensureLivePrivateDirectory } from "./live-private-files.mjs";
import { writeTextAtomic } from "./util.mjs";

const THEME_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const IMAGE = /\.(?:png|jpe?g|webp)$/i;
const MAX_THEME_BYTES = 1024 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const OPEN = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function contained(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function stableBytes(filename, maximum, label, { optional = false } = {}) {
  let handle;
  try { handle = await fs.open(filename, OPEN); }
  catch (error) {
    if (optional && error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximum) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after) || bytes.length !== after.size) {
      throw new Error(`${label} changed while being read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function imageRecord(root, image) {
  const requested = path.join(root, image);
  const entry = await fs.lstat(requested);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("theme image must be a real file");
  const filename = await fs.realpath(requested);
  if (!contained(root, filename)) throw new Error("theme image escaped its root");
  const handle = await fs.open(filename, OPEN);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_IMAGE_BYTES) {
      throw new Error("theme image is not a bounded regular file");
    }
    const extension = path.extname(filename).toLowerCase();
    if (!IMAGE.test(extension)) throw new Error("theme image type is unsupported");
    const metadata = await readLiveImageMetadata(handle, extension, before.size);
    if (!metadata) throw new Error("theme image metadata is invalid");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer, 0, Math.min(buffer.length, before.size - position), position,
      );
      if (bytesRead < 1) throw new Error("theme image ended while hashing");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error("theme image changed while hashing");
    return {
      bytes: before.size,
      extension,
      hash: hash.digest("hex"),
      metadata,
      path: filename,
    };
  } finally {
    await handle.close();
  }
}

function mime(extension) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function compileTheme(directory, source, shared) {
  const entry = await fs.lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("theme root must be a real directory");
  const root = await fs.realpath(directory);
  const configPath = path.join(root, "theme.json");
  const theme = parseTheme(await stableBytes(configPath, MAX_THEME_BYTES, "theme.json"), configPath);
  if (theme.id !== path.basename(root)) throw new Error("theme id does not match its directory");
  const cssBytes = await stableBytes(path.join(root, "theme.css"), MAX_CSS_BYTES, "theme.css",
    { optional: true });
  const safeCss = cssBytes ? decodeAndValidateSafeCss(cssBytes) : null;
  const image = await imageRecord(root, theme.image);
  const sourceRevision = createHash("sha256").update(shared.version).update(shared.template)
    .update(JSON.stringify(theme)).update(safeCss?.runtimeSource ?? "").update(image.hash)
    .digest("hex").slice(0, 24);
  const prepared = compileSource({
    art: null,
    artHash: image.hash,
    artMetadata: image.metadata,
    imageBytes: image.bytes,
    mime: mime(image.extension),
    safeCssRuntime: safeCss?.runtimeSource ?? "",
    safeCssStatus: safeCss ? "validated" : "none",
    sourceRevision,
    template: shared.template,
    theme,
    version: shared.version,
  }, "blob:codexctl-pending");
  return {
    id: theme.id,
    image: {
      bytes: image.bytes,
      hash: image.hash,
      metadata: image.metadata,
      mime: mime(image.extension),
      path: image.path,
    },
    name: theme.name,
    payload: prepared.payload,
    revision: prepared.revision,
    safeCssStatus: safeCss ? "validated" : "none",
    schema: "codexctl-live-wallpaper-artifact/1",
    source,
    status: "available",
    theme,
  };
}

async function roots(paths) {
  await ensureLivePrivateDirectory(paths.userThemesDir);
  return [
    { directory: await fs.realpath(paths.wallpaperLibraryDir), source: "bundled" },
    { directory: await fs.realpath(paths.userThemesDir), source: "user" },
  ];
}

async function inventory(paths) {
  const records = [];
  for (const root of await roots(paths)) {
    for (const entry of (await fs.readdir(root.directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const directory = path.join(root.directory, entry.name);
      const rootStat = await fs.lstat(directory);
      records.push([root.source, entry.name, rootStat.mode, rootStat.size, rootStat.mtimeMs, rootStat.ctimeMs]);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !THEME_ID.test(entry.name)) continue;
      for (const child of (await fs.readdir(directory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const stat = await fs.lstat(path.join(directory, child.name));
        records.push([root.source, entry.name, child.name, stat.mode, stat.size,
          stat.mtimeMs, stat.ctimeMs]);
      }
    }
  }
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

async function readCurrent(paths, fingerprint) {
  try {
    const current = JSON.parse((await stableBytes(
      paths.liveCatalogCurrentFile, 64 * 1024, "live catalog current",
    )).toString("utf8"));
    if (current?.schema !== "codexctl-live-catalog-current/1"
      || current.inventoryFingerprint !== fingerprint
      || !/^[a-f0-9]{24}$/.test(current.revision)) return null;
    const filename = path.join(paths.liveCatalogGenerationsDir, current.revision, "catalog.json");
    const catalog = JSON.parse((await stableBytes(
      filename, 8 * 1024 * 1024, "live wallpaper catalog",
    )).toString("utf8"));
    if (catalog?.schema !== "codexctl-live-wallpaper-catalog/1"
      || catalog.revision !== current.revision
      || catalog.inventoryFingerprint !== fingerprint) return null;
    if (catalogRevision(fingerprint, catalog.entries) !== catalog.revision) {
      throw new Error("live catalog integrity check failed");
    }
    return { ...catalog, reused: true };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function catalogRevision(fingerprint, entries) {
  return createHash("sha256").update(fingerprint).update(JSON.stringify(entries))
    .digest("hex").slice(0, 24);
}

async function publish(paths, catalog) {
  await ensureLivePrivateDirectory(paths.liveCatalogGenerationsDir);
  const destination = path.join(paths.liveCatalogGenerationsDir, catalog.revision);
  const exists = await fs.stat(destination).then((stat) => stat.isDirectory()).catch(() => false);
  if (exists) {
    const existing = JSON.parse((await stableBytes(
      path.join(destination, "catalog.json"), 8 * 1024 * 1024, "existing live catalog",
    )).toString("utf8"));
    if (existing?.schema !== catalog.schema || existing.revision !== catalog.revision
      || existing.inventoryFingerprint !== catalog.inventoryFingerprint
      || catalogRevision(existing.inventoryFingerprint, existing.entries) !== existing.revision) {
      throw new Error("live catalog generation collision");
    }
  } else {
    const stage = await fs.mkdtemp(path.join(paths.liveCatalogGenerationsDir, ".stage-"));
    try {
      await writeTextAtomic(path.join(stage, "catalog.json"), `${JSON.stringify(catalog)}\n`, 0o600);
      await fs.rename(stage, destination);
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  await writeTextAtomic(paths.liveCatalogCurrentFile, `${JSON.stringify({
    inventoryFingerprint: catalog.inventoryFingerprint,
    revision: catalog.revision,
    schema: "codexctl-live-catalog-current/1",
  })}\n`, 0o600);
  await Promise.all([
    assertLivePrivateFile(path.join(destination, "catalog.json")),
    assertLivePrivateFile(paths.liveCatalogCurrentFile),
  ]);
}

export async function compileLiveWallpaperCatalog(paths) {
  const inventoryFingerprint = await inventory(paths);
  const current = await readCurrent(paths, inventoryFingerprint);
  if (current) return current;
  const shared = {
    template: await fs.readFile(path.join(paths.projectRoot, "vendor", "wallpaper-lite", "renderer.js"), "utf8"),
    version: (await fs.readFile(path.join(paths.projectRoot, "vendor", "wallpaper-lite", "VERSION"), "utf8")).trim(),
  };
  const entries = [];
  for (const root of await roots(paths)) {
    for (const entry of (await fs.readdir(root.directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (!THEME_ID.test(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        entries.push({
          error: "theme root must be a real directory",
          id: entry.name,
          schema: "codexctl-live-wallpaper-artifact/1",
          source: root.source,
          status: "unavailable",
        });
        continue;
      }
      try { entries.push(await compileTheme(path.join(root.directory, entry.name), root.source, shared)); }
      catch (error) {
        entries.push({
          error: String(error.message ?? error).slice(0, 500),
          id: entry.name,
          schema: "codexctl-live-wallpaper-artifact/1",
          source: root.source,
          status: "unavailable",
        });
      }
    }
  }
  const revision = catalogRevision(inventoryFingerprint, entries);
  const catalog = {
    createdAt: new Date().toISOString(),
    entries,
    inventoryFingerprint,
    revision,
    schema: "codexctl-live-wallpaper-catalog/1",
  };
  await publish(paths, catalog);
  return { ...catalog, reused: false };
}
