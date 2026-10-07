import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../src/paths.mjs";
import { liveCodeRevision } from "../src/live-code.mjs";
import { LiveSlotManager } from "../src/live-state.mjs";
import { emptyLiveResources } from "../src/live-diagnostics.mjs";

const execFileAsync = promisify(execFile);

async function repository(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-reload-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  await fs.mkdir(project);
  await Promise.all(["src", "vendor", "assets"].map((name) => (
    fs.cp(path.join(PROJECT_ROOT, name), path.join(project, name), { recursive: true })
  )));
  return { directory, project };
}

async function catalogInFreshProcess(project, home) {
  const url = pathToFileURL(path.join(project, "src", "live-wallpaper-catalog.mjs")).href;
  const pathsUrl = pathToFileURL(path.join(project, "src", "paths.mjs")).href;
  const source = `
    const { compileLiveWallpaperCatalog } = await import(${JSON.stringify(url)});
    const { resolvePaths } = await import(${JSON.stringify(pathsUrl)});
    const catalog = await compileLiveWallpaperCatalog(resolvePaths());
    const theme = catalog.entries.find(entry => entry.id === "yuugohan-tsuri");
    process.stdout.write(JSON.stringify({
      revision: catalog.revision, reused: catalog.reused,
      updated: theme.payload.includes("--codexctl-reload-probe: 1")
    }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, CODEXCTL_HOME: home }, timeout: 15_000,
  });
  return JSON.parse(stdout);
}

test("[LIVE-RELOAD-ALL-CODE-001] a fresh process applies changed CSS compiler code instead of cached wallpaper", async (t) => {
  const { directory, project } = await repository(t);
  const home = path.join(directory, "state");
  const before = await catalogInFreshProcess(project, home);
  const filename = path.join(project, "vendor", "wallpaper-lite", "wallpaper-css.mjs");
  const source = await fs.readFile(filename, "utf8");
  const marker = "  --codexctl-wallpaper-border:";
  assert.ok(source.includes(marker));
  await fs.writeFile(filename, source.replace(marker, "  --codexctl-reload-probe: 1;\n" + marker));
  const after = await catalogInFreshProcess(project, home);
  assert.equal(after.updated, true, "the displayed wallpaper must include the new compiler output");
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.reused, false);
});

test("[LIVE-RELOAD-ALL-CODE-001] runtime revisions include new dependency files and exclude generated state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-code-revision-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, "state");
  const paths = { projectRoot: directory, home };
  await fs.mkdir(home);
  const initial = await liveCodeRevision(paths);
  await fs.writeFile(path.join(home, "runtime.json"), '{"value":1}');
  assert.equal(await liveCodeRevision(paths), initial);
  await fs.mkdir(path.join(directory, "lib"));
  await fs.writeFile(path.join(directory, "lib", "new-dependency.cjs"), "module.exports = 1;\n");
  const added = await liveCodeRevision(paths);
  assert.notEqual(added, initial);
  await fs.writeFile(path.join(directory, "lib", "new-dependency.cjs"), "module.exports = 2;\n");
  assert.notEqual(await liveCodeRevision(paths), added);
});

function memoryAdapter(previous = null, rejected = null) {
  let mounted = previous;
  return {
    current: () => mounted,
    async mount(_id, artifact) {
      if (artifact.revision === rejected) throw new Error("candidate rejected");
      mounted = artifact;
    },
    async unmount() { mounted = null; },
    async diagnostics() {
      return {
        handleCount: mounted ? 1 : 0, mounted: Boolean(mounted),
        resources: { ...emptyLiveResources(), styles: mounted ? 1 : 0 },
        revision: mounted?.revision ?? null,
      };
    },
  };
}

test("[LIVE-RELOAD-ALL-CODE-001] a failed handoff restores the actual previous artifact", async () => {
  const previous = { id: "wallpaper", revision: "a".repeat(24), payload: "old" };
  const candidate = { id: "wallpaper", revision: "b".repeat(24), payload: "new" };
  const adapter = memoryAdapter(previous, candidate.revision);
  const manager = new LiveSlotManager({ adapter, slots: [{
    id: "wallpaper", stableArtifact: candidate, stableEnabled: true,
    actual: { kind: "stable", artifact: previous },
  }] });
  await assert.rejects(manager.initialize(), /candidate rejected/);
  assert.equal(adapter.current().revision, previous.revision);
  assert.equal(manager.snapshot().lastTransaction.status, "rolled-back");
});

test("[LIVE-RELOAD-ALL-CODE-001] debug handoff retains its baseline and can recover after connection loss", async () => {
  const stable = { id: "wallpaper", revision: "a".repeat(24), payload: "stable" };
  const debug = { id: "wallpaper", revision: "b".repeat(24), payload: "debug" };
  const adapter = memoryAdapter(stable);
  const manager = new LiveSlotManager({ adapter, slots: [{
    id: "wallpaper", stableArtifact: stable, stableEnabled: true,
    actual: { kind: "stable", artifact: stable },
    debug: { artifact: debug, source: "/tmp/example-theme", sequence: 2, watch: true },
  }] });
  await manager.initialize();
  assert.equal(adapter.current().revision, debug.revision);
  await adapter.unmount();
  await manager.reconcile();
  assert.equal(adapter.current().revision, debug.revision);
  await manager.stopDebug("wallpaper");
  assert.equal(adapter.current().revision, stable.revision);
});
