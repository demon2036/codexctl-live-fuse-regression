import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("the bounded layout fragment exists and every renderer fragment is fingerprinted", async () => {
  const rendererDirectory = path.join(ROOT, "vendor", "prompt-context", "renderer");
  const fragments = (await fs.readdir(rendererDirectory))
    .filter((name) => name.endsWith(".part.js"));
  const required = [...new Set([...fragments, "51-control-layout.part.js"])].sort();
  const runtimeSource = await fs.readFile(path.join(ROOT, "src", "runtime.mjs"), "utf8");
  const start = runtimeSource.indexOf("function engineSourceFiles");
  const end = runtimeSource.indexOf("async function engineRevisions");
  assert.ok(start >= 0 && end > start, "runtime fingerprint source block must be identifiable");
  const fingerprintSource = runtimeSource.slice(start, end);
  const missingFiles = required.filter((name) => !fragments.includes(name));
  const missingFingerprint = required.filter((name) => (
    !fingerprintSource.includes(`"${name.replace(/\.part\.js$/, "")}"`)
  ));
  assert.deepEqual({ missingFiles, missingFingerprint }, {
    missingFiles: [],
    missingFingerprint: [],
  });
});
