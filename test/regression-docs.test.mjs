import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regressionCases } from "../regression/catalog/index.mjs";
import { renderCatalogSummary } from "../regression/catalog/report.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCUMENTS = [
  "README.md", "docs/ARCHITECTURE.md", "docs/CODE_SOP.md", "docs/LINUX.md",
  "docs/REGRESSION_CATALOG.md", "docs/TESTING.md", "docs/LTS.md",
];

test("generated catalog is current and contains every regression case exactly once", async () => {
  const actual = await fs.readFile(path.join(ROOT, "docs", "REGRESSION_CATALOG.md"), "utf8");
  assert.equal(actual, renderCatalogSummary(regressionCases));
  for (const { id } of regressionCases) {
    assert.equal(actual.split(`\`${id}\``).length - 1, 1, id);
  }
});

test("documentation uses valid relative links and real npm commands", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  for (const relative of DOCUMENTS) {
    const filename = path.join(ROOT, relative);
    const source = await fs.readFile(filename, "utf8");
    for (const match of source.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      await assert.doesNotReject(fs.access(path.resolve(path.dirname(filename), target)),
        `${relative}: ${target}`);
    }
    for (const match of source.matchAll(/^npm run ([a-z0-9:-]+)(?:\s|$)/gm)) {
      assert.equal(typeof pkg.scripts[match[1]], "string", `${relative}: npm run ${match[1]}`);
    }
  }
});

test("testing docs contain no obsolete preload deadline or manual-boundary claims", async () => {
  const source = await fs.readFile(path.join(ROOT, "docs", "TESTING.md"), "utf8");
  assert.doesNotMatch(source, /5 秒确定失败|12 秒总硬期限|配合 Computer Use/);
  assert.match(source, /共享有界预算/);
  assert.match(source, /macOS 原生 Accessibility probe/);
});
