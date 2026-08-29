import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  testElectronCiOptions,
  waitForJson,
} from "../regression/electron-runtime.mjs";

test("Electron fixture CI compatibility is explicit and leaves local launches unchanged", () => {
  assert.deepEqual(testElectronCiOptions({}), { arguments: [], showWindow: false });
  assert.deepEqual(testElectronCiOptions({ CODEXCTL_TEST_ELECTRON_CI: "0" }), {
    arguments: [], showWindow: false,
  });
  assert.deepEqual(testElectronCiOptions({ CODEXCTL_TEST_ELECTRON_CI: "1" }), {
    arguments: ["--no-sandbox", "--disable-gpu"], showWindow: true,
  });
});

test("readiness ignores a partial JSON publication", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-ready-json-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "ready.json");
  const pending = waitForJson(filename, 1000);
  await fs.writeFile(filename, '{"pid":', { mode: 0o600 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(filename, '{"pid":123,"url":"app://-/index.html"}\n', { mode: 0o600 });
  assert.deepEqual(await pending, { pid: 123, url: "app://-/index.html" });
});

test("[TDD-BOUNDED-DEADLINE-018] fixture readiness uses its declared shared deadline", async () => {
  const source = await fs.readFile(
    new URL("../regression/electron-runtime.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /ready\s*=\s*await waitForJson\(readyFile,\s*deadlineMs\)/);
  assert.doesNotMatch(source, /ready\s*=\s*await waitForJson\(readyFile\);/);
});
