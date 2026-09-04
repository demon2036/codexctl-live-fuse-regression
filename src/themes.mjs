import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigError, UsageError } from "./errors.mjs";
import { ensurePrivateDirectory, withFileLock, writeTextAtomic } from "./util.mjs";
import { decodeThemeZip, encodeThemeZip } from "./theme-archive.mjs";
import { loadTheme } from "../vendor/wallpaper-lite/theme-loader.mjs";

const THEME_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp)$/i;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function assertThemeId(value) {
  const id = String(value ?? "");
  if (!THEME_ID.test(id) || id.length > 80) throw new UsageError(`无效主题 id：${id || "<missing>"}`);
  return id;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative)
    && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function stableRead(filename, maximumBytes, label) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error.code === "ELOOP") throw new ConfigError(`${label} 不能是符号链接。`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new ConfigError(`${label} 大小必须为 1–${maximumBytes} bytes。`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new ConfigError(`${label} 在读取过程中发生变化。`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function libraryRoot(paths, source) {
  const directory = source === "user" ? paths.userThemesDir : paths.wallpaperLibraryDir;
  if (source === "user") await ensurePrivateDirectory(directory);
  return fs.realpath(directory);
}

async function themeDirectory(paths, id, source) {
  const root = await libraryRoot(paths, source);
  const requested = path.join(root, assertThemeId(id));
  let entry;
  try { entry = await fs.lstat(requested); }
  catch (error) {
    if (error.code === "ENOENT") throw new UsageError(`找不到 ${source === "user" ? "用户" : "内置"}主题：${id}`);
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ConfigError(`主题目录无效：${requested}`);
  const canonical = await fs.realpath(requested);
  if (!contained(root, canonical)) throw new ConfigError(`主题目录越界：${id}`);
  return canonical;
}

async function summaries(paths, source) {
  const root = await libraryRoot(paths, source);
  const rows = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !THEME_ID.test(entry.name)) continue;
    try {
      const loaded = await loadTheme(path.join(root, entry.name));
      rows.push({
        id: loaded.theme.id,
        name: loaded.theme.name,
        appearance: loaded.theme.appearance ?? "auto",
        image: loaded.theme.image,
        source,
        valid: loaded.theme.id === entry.name,
      });
    } catch (error) {
      rows.push({ id: entry.name, name: `<invalid: ${error.message}>`, source, valid: false });
    }
  }
  return rows;
}

export async function listAvailableThemes(paths) {
  const [bundled, user] = await Promise.all([summaries(paths, "bundled"), summaries(paths, "user")]);
  return [...bundled, ...user];
}

export async function loadAvailableTheme(paths, id, source = null) {
  const themeId = assertThemeId(id);
  let selectedSource = source;
  if (!selectedSource) {
    const userCandidate = path.join(paths.userThemesDir, themeId);
    selectedSource = await fs.stat(userCandidate).then((stat) => stat.isDirectory()).catch(() => false)
      ? "user" : "bundled";
  }
  if (!new Set(["bundled", "user"]).has(selectedSource)) {
    throw new UsageError(`无效主题来源：${selectedSource}`);
  }
  const sourceDir = await themeDirectory(paths, themeId, selectedSource);
  const loaded = await loadTheme(sourceDir);
  if (loaded.theme.id !== themeId) throw new ConfigError(`主题目录 ${themeId} 声明了不同 id：${loaded.theme.id}`);
  return { source: selectedSource, sourceDir, ...loaded };
}

async function assertNoBundledCollision(paths, id) {
  if (await fs.stat(path.join(paths.wallpaperLibraryDir, id)).then(() => true).catch(() => false)) {
    throw new UsageError(`用户主题不能覆盖内置主题 id：${id}`);
  }
}

async function publishStagedTheme(paths, stage, id, { replace = false } = {}) {
  return withFileLock(paths.themesLockFile, async () => {
    await assertNoBundledCollision(paths, id);
    const destination = path.join(paths.userThemesDir, id);
    const exists = await fs.lstat(destination).then(() => true).catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (exists && !replace) throw new UsageError(`用户主题 ${id} 已存在；明确传入 --replace 才可替换。`);
    const backup = `${destination}.backup-${randomUUID()}`;
    if (exists) await fs.rename(destination, backup);
    try {
      await fs.rename(stage, destination);
      if (exists) await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (exists) await fs.rename(backup, destination).catch(() => {});
      throw error;
    }
    return destination;
  });
}

export async function importThemeArchive(paths, archivePath, options = {}) {
  await ensurePrivateDirectory(paths.userThemesDir);
  const canonical = await fs.realpath(path.resolve(archivePath)).catch((error) => {
    if (error.code === "ENOENT") throw new UsageError(`主题 ZIP 不存在：${archivePath}`);
    throw error;
  });
  const archive = await stableRead(canonical, MAX_ARCHIVE_BYTES, "主题 ZIP");
  const entries = decodeThemeZip(archive);
  const configEntry = entries.get("theme.json");
  if (!configEntry) throw new ConfigError("主题 ZIP 缺少 theme.json。" );
  let raw;
  try { raw = JSON.parse(configEntry.content.toString("utf8")); }
  catch { throw new ConfigError("主题 ZIP 的 theme.json 不是合法 JSON。" ); }
  const id = assertThemeId(raw?.id);
  if (raw?.schemaVersion !== 1 || typeof raw.image !== "string"
    || path.basename(raw.image) !== raw.image || !IMAGE_EXTENSION.test(raw.image)) {
    throw new ConfigError("主题 ZIP 的 schemaVersion/image 无效。" );
  }
  const allowed = new Set(["theme.json", "theme.css", raw.image.toLowerCase()]);
  for (const name of entries.keys()) {
    if (!allowed.has(name)) throw new ConfigError(`主题 ZIP 含有不需要的文件：${name}`);
  }
  const image = entries.get(raw.image.toLowerCase());
  if (!image) throw new ConfigError(`主题 ZIP 缺少图片：${raw.image}`);
  const stage = await fs.mkdtemp(path.join(paths.userThemesDir, ".import-"));
  let published = false;
  try {
    for (const entry of entries.values()) {
      await fs.writeFile(path.join(stage, entry.name), entry.content, { mode: 0o600, flag: "wx" });
    }
    const loaded = await loadTheme(stage);
    if (loaded.theme.id !== id) throw new ConfigError("导入后主题 id 校验失败。" );
    const destination = await publishStagedTheme(paths, stage, id, options);
    published = true;
    return { id, name: loaded.theme.name, destination, source: "user" };
  } finally {
    if (!published) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

export async function exportThemeArchive(paths, id, source, destination, options = {}) {
  const loaded = await loadAvailableTheme(paths, id, source);
  const themeJson = await stableRead(path.join(loaded.sourceDir, "theme.json"), 1024 * 1024, "theme.json");
  const files = [
    { name: "theme.json", content: themeJson },
    { name: loaded.theme.image, content: loaded.art },
  ];
  if (loaded.safeCss) files.push({ name: "theme.css", content: Buffer.from(loaded.safeCss, "utf8") });
  const archive = encodeThemeZip(files);
  const output = path.resolve(destination);
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const flag = options.force ? "w" : "wx";
  try { await fs.writeFile(output, archive, { mode: 0o600, flag }); }
  catch (error) {
    if (error.code === "EEXIST") throw new UsageError(`导出文件已存在：${output}；明确传入 --force 才可覆盖。`);
    throw error;
  }
  await fs.chmod(output, 0o600).catch(() => {});
  return { id: loaded.theme.id, name: loaded.theme.name, output, bytes: archive.length };
}

function cleanText(value, fallback, maximum = 120) {
  const text = String(value ?? fallback).trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)) {
    throw new UsageError(`主题文本必须是 1–${maximum} 个无控制字符的单行文本。`);
  }
  return text;
}

export async function createUserTheme(paths, input, options = {}) {
  await ensurePrivateDirectory(paths.userThemesDir);
  const id = assertThemeId(input.id);
  const canonicalImage = await fs.realpath(path.resolve(input.image)).catch((error) => {
    if (error.code === "ENOENT") throw new UsageError(`壁纸图片不存在：${input.image}`);
    throw error;
  });
  const extension = path.extname(canonicalImage).toLowerCase();
  if (!IMAGE_EXTENSION.test(extension)) throw new UsageError("主题图片只支持 PNG、JPEG、WebP。" );
  const art = await stableRead(canonicalImage, MAX_IMAGE_BYTES, "主题图片");
  const image = `background${extension === ".jpeg" ? ".jpg" : extension}`;
  const theme = {
    schemaVersion: 1,
    id,
    name: cleanText(input.name, id, 80),
    brandSubtitle: "CODEXCTL WALLPAPER",
    tagline: cleanText(input.tagline, "Make something wonderful.", 160),
    projectPrefix: "选择项目 · ",
    projectLabel: "◉  选择项目",
    statusText: "CODEXCTL ONLINE",
    quote: cleanText(input.quote, "MAKE SOMETHING WONDERFUL", 80),
    image,
    appearance: input.appearance ?? "dark",
    art: {
      focusX: input.focusX ?? 0.5,
      focusY: input.focusY ?? 0.5,
      safeArea: input.safeArea ?? "auto",
      taskMode: input.taskMode ?? "auto",
    },
    tuning: {
      overlayOpacity: input.overlayOpacity ?? 0.34,
      gradientBias: input.gradientBias ?? 0,
      sidebarOpacity: input.sidebarOpacity ?? 0.68,
      composerOpacity: input.composerOpacity ?? 0.82,
    },
  };
  const stage = await fs.mkdtemp(path.join(paths.userThemesDir, ".create-"));
  let published = false;
  try {
    await fs.writeFile(path.join(stage, image), art, { mode: 0o600, flag: "wx" });
    await writeTextAtomic(path.join(stage, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`, 0o600);
    await loadTheme(stage);
    const destination = await publishStagedTheme(paths, stage, id, options);
    published = true;
    return { id, name: theme.name, destination, source: "user" };
  } finally {
    if (!published) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeUserTheme(paths, id) {
  const themeId = assertThemeId(id);
  return withFileLock(paths.themesLockFile, async () => {
    const source = await themeDirectory(paths, themeId, "user");
    const trash = path.join(paths.userThemesDir, ".trash");
    await ensurePrivateDirectory(trash);
    const destination = path.join(trash, `${themeId}-${Date.now()}-${randomUUID()}`);
    await fs.rename(source, destination);
    return { id: themeId, recoverableAt: destination };
  });
}
