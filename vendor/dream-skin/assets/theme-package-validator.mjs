#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decodeAndValidateSafeCss } from "./safe-css-validator.mjs";
import { detectedImageMedia, setsEqual, sha256 } from "./theme-package-media.mjs";
import {
  BACKGROUND_MEDIA,
  COLOR_KEYS,
  COLOR_PATTERN,
  CONTROL_PATTERN,
  KEY_ID_PATTERN,
  LICENSE_PATTERN,
  LIMITS,
  MANIFEST_REQUIRED,
  PACKAGE_FILES,
  PAYLOAD_MEDIA,
  PROVENANCE_CONTROL_PATTERN,
  PUBLISHER_ID_PATTERN,
  RFC3339_PATTERN,
  THEME_COPY_KEYS,
  THEME_ID_PATTERN,
  THEME_REQUIRED,
  assertExactKeys,
  assertObject,
  assertString,
  assertStringSet,
  compareSemver,
  decodeJson,
  expectedLimit,
  fail,
  parseArguments,
  parseSemver,
  readStableFile,
  resolveDirectory,
  sourceFileNames,
} from "./theme-package-shared.mjs";

export { codePointLength, normalizeThemeColor, normalizeThemeText } from "./theme-package-shared.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function validateTimestamp(value) {
  assertString(value, "manifest.createdAt", { min: 1, max: 40, pattern: RFC3339_PATTERN, controls: null });
  if (!Number.isFinite(Date.parse(value))) fail("manifest.createdAt is not a valid date-time");
}

function validateOfficialTheme(value) {
  const theme = assertObject(value, "theme.json");
  assertExactKeys(
    theme,
    THEME_REQUIRED,
    [...THEME_COPY_KEYS, "promoUrl", "appearance", "art", "colors"],
    "theme.json",
  );
  if (theme.schemaVersion !== 1) fail("theme.json must use schemaVersion 1");
  assertString(theme.id, "theme.json.id", { min: 3, max: 64, pattern: THEME_ID_PATTERN, controls: null });
  assertString(theme.name, "theme.json.name", { min: 1, max: 80 });
  assertString(theme.image, "theme.json.image", { min: 1, max: 32, controls: null });
  if (!BACKGROUND_MEDIA.has(theme.image)) fail("theme.json.image must name one registered background file");
  for (const key of THEME_COPY_KEYS) {
    if (theme[key] !== undefined) assertString(theme[key], `theme.json.${key}`, { max: 120 });
  }
  if (theme.promoUrl !== undefined) assertString(theme.promoUrl, "theme.json.promoUrl", { max: 512 });
  if (theme.appearance !== undefined && !new Set(["auto", "light", "dark"]).has(theme.appearance)) {
    fail("theme.json.appearance is unsupported");
  }
  if (theme.art !== undefined) {
    const art = assertObject(theme.art, "theme.json.art");
    assertExactKeys(art, [], ["focusX", "focusY", "safeArea", "taskMode"], "theme.json.art");
    for (const key of ["focusX", "focusY"]) {
      if (art[key] !== undefined && (typeof art[key] !== "number" || !Number.isFinite(art[key]) || art[key] < 0 || art[key] > 1)) {
        fail(`theme.json.art.${key} must be between 0 and 1`);
      }
    }
    if (art.safeArea !== undefined && !new Set(["left", "right", "none"]).has(art.safeArea)) {
      fail("theme.json.art.safeArea is unsupported");
    }
    if (art.taskMode !== undefined && !new Set(["ambient", "full", "off"]).has(art.taskMode)) {
      fail("theme.json.art.taskMode is unsupported");
    }
  }
  if (theme.colors !== undefined) {
    const colors = assertObject(theme.colors, "theme.json.colors");
    assertExactKeys(colors, COLOR_KEYS, [], "theme.json.colors");
    for (const key of COLOR_KEYS) {
      assertString(colors[key], `theme.json.colors.${key}`, {
        min: 1,
        max: 64,
        pattern: COLOR_PATTERN,
        controls: null,
      });
    }
  }
  return theme;
}

function validateManifest(value, platform, clientVersion) {
  const manifest = assertObject(value, "manifest.json");
  assertExactKeys(manifest, MANIFEST_REQUIRED, ["keyId"], "manifest.json");
  if (manifest.packageVersion !== 1) fail("manifest.json must use packageVersion 1");
  if (manifest.skinApiVersion !== 1) fail("manifest.json requires an unsupported Skin API version");
  assertString(manifest.themeId, "manifest.themeId", {
    min: 3,
    max: 64,
    pattern: THEME_ID_PATTERN,
    controls: null,
  });
  parseSemver(manifest.version, "manifest.version");
  const requiredClient = parseSemver(manifest.minClientVersion, "manifest.minClientVersion");
  const installedClient = parseSemver(clientVersion, "client version");
  if (compareSemver(requiredClient, installedClient) > 0) {
    fail(`Theme requires Dream Skin ${manifest.minClientVersion} or newer; installed version is ${clientVersion}`);
  }
  const platforms = assertStringSet(manifest.platforms, "manifest.platforms", {
    min: 1,
    max: 2,
    allowed: new Set(["macos", "windows"]),
  });
  if (!platforms.has(platform)) fail(`Theme package does not support ${platform}`);
  const capabilities = assertStringSet(manifest.capabilities, "manifest.capabilities", {
    min: 1,
    max: 3,
    allowed: new Set(["background", "tokens", "safe-css"]),
  });

  const publisher = assertObject(manifest.publisher, "manifest.publisher");
  assertExactKeys(publisher, ["id", "displayName"], [], "manifest.publisher");
  assertString(publisher.id, "manifest.publisher.id", {
    min: 1,
    max: 64,
    pattern: PUBLISHER_ID_PATTERN,
    controls: null,
  });
  assertString(publisher.displayName, "manifest.publisher.displayName", { min: 1, max: 80 });
  assertString(manifest.license, "manifest.license", {
    min: 1,
    max: 64,
    pattern: LICENSE_PATTERN,
    controls: null,
  });
  const provenance = assertObject(manifest.provenance, "manifest.provenance");
  assertExactKeys(provenance, ["aiGenerated", "summary"], [], "manifest.provenance");
  if (typeof provenance.aiGenerated !== "boolean") fail("manifest.provenance.aiGenerated must be boolean");
  assertString(provenance.summary, "manifest.provenance.summary", {
    min: 1,
    max: 500,
    controls: PROVENANCE_CONTROL_PATTERN,
  });
  if (manifest.keyId !== undefined) {
    assertString(manifest.keyId, "manifest.keyId", {
      min: 1,
      max: 64,
      pattern: KEY_ID_PATTERN,
      controls: null,
    });
  }
  validateTimestamp(manifest.createdAt);

  if (!Array.isArray(manifest.files) || manifest.files.length < 2 || manifest.files.length > 8) {
    fail("manifest.files must contain between 2 and 8 entries");
  }
  const files = new Map();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = assertObject(manifest.files[index], `manifest.files[${index}]`);
    assertExactKeys(entry, ["path", "mediaType", "bytes", "sha256"], [], `manifest.files[${index}]`);
    if (typeof entry.path !== "string" || !PAYLOAD_MEDIA.has(entry.path)) {
      fail(`manifest.files[${index}].path is unsupported`);
    }
    if (files.has(entry.path)) fail(`manifest.files repeats ${entry.path}`);
    if (entry.mediaType !== PAYLOAD_MEDIA.get(entry.path)) {
      fail(`manifest.files mediaType does not match ${entry.path}`);
    }
    const limit = expectedLimit(entry.path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > limit) {
      fail(`manifest.files bytes for ${entry.path} exceed its limit`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      fail(`manifest.files SHA-256 for ${entry.path} is invalid`);
    }
    files.set(entry.path, entry);
  }
  const backgrounds = [...files.keys()].filter((name) => BACKGROUND_MEDIA.has(name));
  if (!files.has("theme.json") || backgrounds.length !== 1) {
    fail("manifest.files must contain theme.json and exactly one background file");
  }
  if (files.has("theme.css") !== capabilities.has("safe-css")) {
    fail("theme.css presence must match the safe-css capability");
  }
  if (!files.has("theme.css")) {
    fail("New official theme imports require theme.css and the safe-css capability");
  }
  return { manifest, files, background: backgrounds[0] };
}

async function validateOfficial(root, names, platform, clientVersion) {
  for (const name of names) {
    if (!PACKAGE_FILES.has(name)) fail(`Official theme package contains unregistered file ${name}`);
  }
  if (!names.includes("manifest.json")) fail("Official theme package is missing manifest.json");
  const bytes = new Map();
  for (const name of names) bytes.set(name, await readStableFile(root, name, expectedLimit(name)));
  const { manifest, files, background } = validateManifest(
    decodeJson(bytes.get("manifest.json"), "manifest.json"),
    platform,
    clientVersion,
  );
  const actualPayload = new Set(names.filter((name) => name !== "manifest.json" && name !== "manifest.sig"));
  if (!setsEqual(actualPayload, new Set(files.keys()))) {
    fail("ZIP payload files do not exactly match manifest.files");
  }
  for (const [name, entry] of files) {
    const data = bytes.get(name);
    if (!data) fail(`manifest.files declares missing file ${name}`);
    if (data.length !== entry.bytes) fail(`${name} byte length does not match manifest.json`);
    if (sha256(data) !== entry.sha256) fail(`${name} SHA-256 does not match manifest.json`);
  }
  const theme = validateOfficialTheme(decodeJson(bytes.get("theme.json"), "theme.json"));
  if (manifest.themeId !== theme.id) fail("manifest.themeId does not match theme.json id");
  if (theme.image !== background) fail("theme.json image does not match the manifest background file");
  if (detectedImageMedia(bytes.get(background)) !== BACKGROUND_MEDIA.get(background)) {
    fail(`${background} content does not match its extension and mediaType`);
  }
  decodeAndValidateSafeCss(bytes.get("theme.css"));
  return {
    format: "official",
    image: background,
    safeCssStatus: "validated",
    signatureIgnored: bytes.has("manifest.sig"),
    bytes,
  };
}

async function validateSimple(root, names) {
  if (names.length !== 3 || !names.includes("theme.json") || !names.includes("theme.css")) {
    fail("Local simplified ZIP must contain exactly theme.json, theme.css, and its image");
  }
  const themeBytes = await readStableFile(root, "theme.json", LIMITS.simpleTheme);
  const theme = assertObject(decodeJson(themeBytes, "theme.json"), "theme.json");
  if (theme.schemaVersion !== 1 || typeof theme.image !== "string" || !theme.image) {
    fail("Local simplified theme must use schemaVersion 1 and name an image");
  }
  if (
    path.basename(theme.image) !== theme.image
    || CONTROL_PATTERN.test(theme.image)
    || !/\.(?:png|jpe?g|webp)$/i.test(theme.image)
    || !names.includes(theme.image)
  ) fail("Local simplified theme image must be beside theme.json");
  const [imageBytes, cssBytes] = await Promise.all([
    readStableFile(root, theme.image, LIMITS.image),
    readStableFile(root, "theme.css", LIMITS.css),
  ]);
  const expectedMedia = /\.png$/i.test(theme.image)
    ? "image/png"
    : /\.webp$/i.test(theme.image) ? "image/webp" : "image/jpeg";
  if (detectedImageMedia(imageBytes) !== expectedMedia) {
    fail(`${theme.image} content does not match its extension`);
  }
  decodeAndValidateSafeCss(cssBytes);
  return {
    format: "simple",
    image: theme.image,
    safeCssStatus: "validated",
    signatureIgnored: false,
    bytes: new Map([
      ["theme.json", themeBytes],
      [theme.image, imageBytes],
      ["theme.css", cssBytes],
    ]),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const source = await resolveDirectory(args.source, "Theme package source");
  const stage = await resolveDirectory(args.stage, "Theme package stage", true);
  const names = await sourceFileNames(source);
  const result = names.includes("manifest.json")
    ? await validateOfficial(source, names, args.platform, args["client-version"])
    : await validateSimple(source, names);
  for (const [name, bytes] of result.bytes) {
    await fs.writeFile(path.join(stage, name), bytes, { flag: "wx", mode: 0o600 });
    await fs.chmod(path.join(stage, name), 0o600);
  }
  return {
    format: result.format,
    image: result.image,
    safeCssStatus: result.safeCssStatus,
    signatureIgnored: result.signatureIgnored,
  };
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch (error) {
    process.stderr.write(`Theme package validation failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
