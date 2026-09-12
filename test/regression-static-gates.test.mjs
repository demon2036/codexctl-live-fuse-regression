import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXCLUDED = new Set([".git", "node_modules", "regression-results"]);
const TEXT = new Set([".c", ".css", ".js", ".json", ".md", ".mjs", ".sh", ".swift", ".txt", ".yaml", ".yml"]);

async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(filename));
    else if (TEXT.has(path.extname(filename))) result.push(filename);
  }
  return result;
}

test("[TDD-FILE-LIMIT-007] every maintained text file stays below the 400-line hard limit", async () => {
  const violations = [];
  for (const filename of await files(ROOT)) {
    const source = await fs.readFile(filename, "utf8");
    const count = source.split(/\r?\n/).length - (/\r?\n$/.test(source) ? 1 : 0);
    if (count > 400) violations.push(`${path.relative(ROOT, filename)}:${count}`);
  }
  assert.deepEqual(violations, []);
});

test("quality sources contain no committed skip or only escape hatch", async () => {
  const violations = [];
  for (const filename of await files(path.join(ROOT, "test"))) {
    const source = await fs.readFile(filename, "utf8");
    if (/\.(?:skip|only)\s*\(/.test(source)) violations.push(path.relative(ROOT, filename));
  }
  assert.deepEqual(violations, []);
});

test("[TDD-ZERO-STEADY-STATE-008] only native control geometry is observed without interval or hot-path listeners", async () => {
  const roots = [
    path.join(ROOT, "vendor", "prompt-context", "renderer"),
    path.join(ROOT, "vendor", "wallpaper-lite"),
  ];
  const filenames = (await Promise.all(roots.map((root) => files(root)))).flat();
  const sources = await Promise.all(filenames.map((filename) => fs.readFile(filename, "utf8")));
  for (const [index, filename] of filenames.entries()) {
    if (path.basename(filename) !== "52-control-observers.part.js") {
      assert.doesNotMatch(sources[index], /new\s+(?:MutationObserver|ResizeObserver)\s*\(/);
    } else {
      assert.equal((sources[index].match(/new MutationObserver\(/g) ?? []).length, 1);
      assert.equal((sources[index].match(/new ResizeObserver\(/g) ?? []).length, 1);
      assert.match(sources[index], /const root = context\?\.footer \?\? state\.controlOwnerObserverRoot/);
      assert.doesNotMatch(sources[index], /document\.(?:querySelector|getElementById)|\.observe\(document\./);
    }
  }
  const source = sources.join("\n");
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /(?:document|window|state\.controlComposer|state\.controlAnchor)\s*\.\s*addEventListener\s*\(\s*["'](?:input|scroll)["']/);
});
