import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { classifyOwnedWorker } from "../src/owned-processes.mjs";
import { resolvePaths } from "../src/paths.mjs";

test("orphan classification requires both the exact project script and controller generation", () => {
  const paths = resolvePaths({
    HOME: path.join(path.sep, "home", "tester"),
    CODEXCTL_HOME: path.join(path.sep, "private", "codexctl-test"),
  });
  assert.equal(classifyOwnedWorker(
    `/usr/bin/node ${paths.promptInjector} --watch --profiles ${paths.runtimeGenerationsDir}/g1/prompt-context.json`,
    paths,
  ), "promptContext");
  assert.equal(classifyOwnedWorker(
    `/usr/bin/node ${paths.wallpaperInjector} --watch --theme-dir ${paths.runtimeGenerationsDir}/g1/theme`,
    paths,
  ), "wallpaper");
  assert.equal(classifyOwnedWorker(
    `/usr/bin/node /tmp/copied/injector.mjs --theme-dir ${paths.runtimeGenerationsDir}/g1/theme`,
    paths,
  ), null);
  assert.equal(classifyOwnedWorker(
    `/usr/bin/node ${paths.wallpaperInjector} --theme-dir /another/controller/runtime/theme`,
    paths,
  ), null);
});
