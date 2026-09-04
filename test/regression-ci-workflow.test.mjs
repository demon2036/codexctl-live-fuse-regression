import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = path.join(ROOT, ".github", "workflows", "regression.yml");

test("CI declares real L1-L5 boundaries without converting missing macOS capability to pass", async () => {
  const source = await fs.readFile(WORKFLOW, "utf8");
  for (const command of [
    "npm run check", "npm test", "npm run test:browser", "npm run test:app",
    "npm run test:performance", "npm run test:platform",
  ]) assert.match(source, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /persistent\.oaistatic\.com\/codex-app-prod\/linux\/deb\/latest/);
  assert.match(source, /status=unverified/);
  assert.doesNotMatch(source, /status=pass/);
  assert.match(source, /regression-results\/platform-evidence\/\*\*\/linux\.json/);
  assert.match(source, /\/usr\/lib\/chatgpt\/ChatGPT[\s\S]*command -v chatgpt/);
  assert.match(source, /CODEXCTL_TEST_ELECTRON_CI:\s*["']1["']/);
  assert.match(source, /CODEXCTL_TEST_OPENAI_API_KEY:\s*\$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(source, /component:\s*\[controls, wallpaper\]/);
  assert.match(source, /performance-component-regression\.mjs --component \$\{\{ matrix\.component \}\}/);
});

test("CI artifacts are allowlisted summaries rather than profiles or raw user state", async () => {
  const source = await fs.readFile(WORKFLOW, "utf8");
  const paths = [...source.matchAll(/^\s+path:\s+(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(paths.sort(), [
    "regression-results/app-*/summary.json",
    "regression-results/performance-component-*/summary.json",
    "regression-results/performance-*/summary.json",
    "regression-results/platform-capability/macos.json",
    "regression-results/platform-evidence/**/linux.json",
  ].sort());
  assert.doesNotMatch(source, /auth\.json|config\.toml|session|user-data-dir/i);
});

test("full performance CI deadline covers the balanced matrix and one bounded resample", async () => {
  const source = await fs.readFile(WORKFLOW, "utf8");
  const job = source.match(/  performance-l4:[\s\S]*?\n  linux-l5:/)?.[0] ?? "";
  const timeout = Number(job.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.ok(timeout >= 45, `performance-l4 timeout is only ${timeout} minutes`);
});
