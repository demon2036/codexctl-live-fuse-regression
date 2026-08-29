import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths, PROJECT_ROOT } from "../src/paths.mjs";
import { materializeRuntime } from "../src/runtime.mjs";
import { decodeThemeZip, encodeThemeZip } from "../src/theme-archive.mjs";
import {
  createUserTheme,
  exportThemeArchive,
  importThemeArchive,
  listAvailableThemes,
  loadAvailableTheme,
} from "../src/themes.mjs";

async function temporaryPaths(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return resolvePaths({ ...process.env, CODEXCTL_HOME: directory });
}

test("pure Node theme ZIP codec round-trips files and rejects traversal", () => {
  const archive = encodeThemeZip([
    { name: "theme.json", content: Buffer.from('{"schemaVersion":1}') },
    { name: "background.png", content: Buffer.from("png") },
  ]);
  const decoded = decodeThemeZip(archive);
  assert.equal(decoded.get("theme.json").content.toString(), '{"schemaVersion":1}');
  assert.equal(decoded.get("background.png").content.toString(), "png");

  const unsafe = Buffer.from(encodeThemeZip([
    { name: "evil.json", content: Buffer.from("x") },
    { name: "image.png", content: Buffer.from("y") },
  ]));
  let cursor = 0;
  while ((cursor = unsafe.indexOf("evil.json", cursor, "ascii")) >= 0) {
    unsafe.write("../x.json", cursor, "ascii");
    cursor += 9;
  }
  assert.throws(() => decodeThemeZip(unsafe), /不安全路径/);
});

test("user theme create, export, and import are portable and validated", async (t) => {
  const sourcePaths = await temporaryPaths(t, "codexctl-theme-source-");
  const image = path.join(PROJECT_ROOT, "examples", "wallpaper.png");
  const created = await createUserTheme(sourcePaths, {
    id: "portable-test",
    image,
    name: "Portable Test",
    appearance: "dark",
    focusX: 0.7,
    focusY: 0.4,
    safeArea: "left",
    taskMode: "ambient",
  });
  assert.equal(created.source, "user");
  const rows = await listAvailableThemes(sourcePaths);
  assert.ok(rows.some((row) => row.id === "portable-test" && row.source === "user" && row.valid));

  const archive = path.join(sourcePaths.home, "portable-test.codex-theme.zip");
  const exported = await exportThemeArchive(sourcePaths, "portable-test", "user", archive);
  assert.ok(exported.bytes > 100);

  const destinationPaths = await temporaryPaths(t, "codexctl-theme-destination-");
  const imported = await importThemeArchive(destinationPaths, archive);
  assert.equal(imported.id, "portable-test");
  const loaded = await loadAvailableTheme(destinationPaths, "portable-test", "user");
  assert.equal(loaded.theme.name, "Portable Test");
  assert.equal(loaded.theme.appearance, "dark");
  assert.equal(loaded.theme.art.focusX, 0.7);
  await assert.rejects(importThemeArchive(destinationPaths, archive), /已存在/);
});

test("selected theme overrides materialize without altering the source theme", async (t) => {
  const paths = await temporaryPaths(t, "codexctl-theme-override-");
  const config = createDefaultConfig();
  config.modules.wallpaper = true;
  config.wallpaper.overrides = {
    appearance: "dark",
    overlayOpacity: 0.17,
    sidebarOpacity: 0.22,
    focusX: 0.61,
  };
  const runtime = await materializeRuntime(config, paths);
  const staged = JSON.parse(await fs.readFile(path.join(runtime.paths.themeDir, "theme.json"), "utf8"));
  const original = JSON.parse(await fs.readFile(
    path.join(PROJECT_ROOT, "assets", "wallpapers", "yuugohan-tsuri", "theme.json"),
    "utf8",
  ));
  assert.equal(staged.appearance, "dark");
  assert.equal(staged.tuning.overlayOpacity, 0.17);
  assert.equal(staged.tuning.sidebarOpacity, 0.22);
  assert.equal(staged.art.focusX, 0.61);
  assert.notEqual(original.tuning.overlayOpacity, staged.tuning.overlayOpacity);
});
