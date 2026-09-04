import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { loadConfig, saveConfig } from "../src/config.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { materializeRuntime, readCurrentRuntime, updateRuntimeConfig } from "../src/runtime.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-config-transaction-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const paths = resolvePaths({ ...process.env, CODEXCTL_HOME: directory });
  const config = createDefaultConfig();
  await saveConfig(paths, config);
  await materializeRuntime(config, paths);
  return { paths, config };
}

test("[INJECTION-ROLLBACK-OFFICIAL-004] failed runtime preparation preserves config and generation", async (t) => {
  const { paths } = await fixture(t);
  const beforeConfig = await fs.readFile(paths.configFile, "utf8");
  const beforeRuntime = await readCurrentRuntime(paths);

  await assert.rejects(updateRuntimeConfig(paths, (draft) => {
    draft.modules.prompt = true;
    draft.prompt.profiles.push({
      id: "missing",
      label: "Missing",
      path: path.join(paths.home, "does-not-exist.md"),
    });
    draft.prompt.defaultProfileId = "missing";
  }), /不存在/);

  assert.equal(await fs.readFile(paths.configFile, "utf8"), beforeConfig);
  assert.equal((await readCurrentRuntime(paths)).generation, beforeRuntime.generation);
  const staging = (await fs.readdir(paths.runtimeGenerationsDir))
    .filter((name) => name.startsWith(".stage-"));
  assert.deepEqual(staging, []);
});

test("concurrent mutations serialize and do not lose independent updates", async (t) => {
  const { paths } = await fixture(t);
  await Promise.all([
    updateRuntimeConfig(paths, async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      draft.prompt.selectionRevision += 1;
    }),
    updateRuntimeConfig(paths, (draft) => {
      draft.context.selectionRevision += 1;
    }),
  ]);
  const saved = await loadConfig(paths);
  assert.equal(saved.prompt.selectionRevision, 1);
  assert.equal(saved.context.selectionRevision, 1);
  await assert.rejects(fs.access(paths.configLockFile));
});
