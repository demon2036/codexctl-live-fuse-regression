import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveThemeAsset } = require("../src/macos-preload-assets.cjs");

test("[INJECTION-LIFECYCLE-PRELOAD-ASSET-CANONICAL-003] accepts a canonical asset through a runtime path alias", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-asset-"));
  const alias = `${directory}-alias`;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.after(() => fs.rm(alias, { force: true }));
  await fs.mkdir(path.join(directory, "theme"));
  await fs.writeFile(path.join(directory, "theme", "art.png"), "fixture");
  await fs.symlink(directory, alias);
  assert.equal(
    resolveThemeAsset(path.join(alias, "macos-preload.json"), "theme/art.png"),
    await fs.realpath(path.join(directory, "theme", "art.png")),
  );
});

test("[INJECTION-LIFECYCLE-PRELOAD-ASSET-CANONICAL-003] rejects a symlink escaping the canonical theme", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-preload-escape-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "runtime", "theme"), { recursive: true });
  await fs.writeFile(path.join(directory, "outside.png"), "fixture");
  await fs.symlink(path.join(directory, "outside.png"), path.join(directory, "runtime", "theme", "art.png"));
  assert.throws(
    () => resolveThemeAsset(
      path.join(directory, "runtime", "macos-preload.json"),
      "theme/art.png",
    ),
    /escaped runtime theme/,
  );
});
