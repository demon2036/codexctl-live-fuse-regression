import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../src/paths.mjs";

test("installer has no automatic takeover path", async () => {
  const source = await fs.readFile(path.join(PROJECT_ROOT, "scripts", "install.sh"), "utf8");
  assert.doesNotMatch(source, /ENABLE_AUTO|auto on|--auto/);
  assert.match(source, /usage: \.\/scripts\/install\.sh \[--no-init\]/);
});
