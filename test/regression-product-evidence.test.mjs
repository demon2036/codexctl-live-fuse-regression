import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regressionCaseById } from "../regression/catalog/index.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EVIDENCE = path.join(
  ROOT, "openspec", "changes", "codify-regression-tdd", "evidence", "product-deviations.md",
);

test("every recorded product deviation has catalog IDs, a behavioral Red, and a Green boundary", async () => {
  const source = await fs.readFile(EVIDENCE, "utf8");
  const sections = source.split(/^## \d+\. /m).slice(1);
  assert.equal(sections.length, 36);
  for (const section of sections) {
    const ids = [...section.matchAll(/`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})`/g)]
      .map((match) => match[1]);
    assert.ok(ids.length > 0, section.slice(0, 80));
    for (const id of ids) assert.ok(regressionCaseById.has(id), id);
    assert.match(section, /- Red：/);
    assert.match(section, /预期失败：/);
    assert.match(section, /最小修复：/);
  }
  assert.match(source, /最终 `summary\.json`/);
  assert.doesNotMatch(source, /语法错误.*算作 Red|默认 retry.*通过/);
});

test("historical preload evidence uses the current shared-budget lifecycle", async () => {
  const filename = path.join(path.dirname(EVIDENCE), "injection-lifecycle-startup-navigation-001.md");
  const source = await fs.readFile(filename, "utf8");
  assert.match(source, /共用只读有界预算/);
  assert.doesNotMatch(source, /5 秒确定失败|12 秒的硬期限/);
});
