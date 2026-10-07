#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { liveReloadFixture, waitForLiveCondition } from "../test-support/live-reload-fixture.mjs";

const fixture = await liveReloadFixture();
const compiler = path.join(fixture.project, "vendor", "wallpaper-lite", "wallpaper-css.mjs");
const host = path.join(fixture.project, "src", "live-host-control.cjs");
const initial = await fixture.current();
const source = await fs.readFile(compiler, "utf8");
const marker = "  --codexctl-wallpaper-border:";
const checks = [];
try {
  await fixture.evaluate('window.__codexctlReloadSentinel = "preserved"');
  await fixture.evaluate('document.getElementById("composer").textContent = "unsent reload draft"');
  await fixture.call("plugin.set", { pluginId: "context", enabled: true });
  await fs.writeFile(compiler, source.replace(marker, "  --codexctl-reload-probe: 1;\n" + marker));
  const hostSource = await fs.readFile(host, "utf8");
  await fs.writeFile(host, hostSource.replace(
    "    const bytes = Uint8Array.from(atob(",
    "    window.__codexctlCjsReloadProbe = 1;\n    const bytes = Uint8Array.from(atob(",
  ));
  console.log("Checking fresh ESM/CJS code in the same isolated App...");
  await fixture.cli("live", "reload");
  const reloaded = await fixture.current();
  assert.notEqual(reloaded.companion.pid, initial.companion.pid);
  await fixture.assertSameApp();
  assert.equal(await fixture.evaluate('window.__codexctlReloadSentinel'), "preserved");
  assert.equal(await fixture.evaluate('document.getElementById("composer").textContent'), "unsent reload draft");
  assert.equal(await fixture.evaluate('window.__codexctlCjsReloadProbe'), 1);
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "1");
  assert.equal((await fixture.call("status")).manager.plugins.context.enabled, true);
  checks.push("fresh ESM and CJS dependencies, same App/document, retained plugin switches");

  console.log("Checking invalid source keeps the previous companion and wallpaper...");
  const working = await fs.readFile(compiler, "utf8");
  await fs.writeFile(compiler, "this is not valid JavaScript\n");
  await assert.rejects(fixture.call("plugin.reload", { pluginId: "all" }));
  assert.equal((await fixture.current()).companion.pid, reloaded.companion.pid);
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "1");
  await fixture.assertSameApp();
  await fs.writeFile(compiler, working);
  checks.push("syntax failure preserves the previous companion and visible wallpaper");

  console.log("Checking renderer failure restores the previous version...");
  const renderer = path.join(fixture.project, "vendor", "wallpaper-lite", "renderer.js");
  const rendererSource = await fs.readFile(renderer, "utf8");
  await fs.writeFile(renderer, 'throw new Error("isolated reload mount failure");\n' + rendererSource);
  await assert.rejects(fixture.call("plugin.reload", { pluginId: "all" }), /isolated reload mount failure/);
  assert.equal((await fixture.current()).companion.pid, reloaded.companion.pid);
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "1");
  await fixture.assertSameApp();
  await fs.writeFile(renderer, rendererSource);
  checks.push("mount failure restores the previous version and command channel");

  console.log("Checking source watch replaces the whole companion and retains debug recovery...");
  await fs.writeFile(compiler, working.replace("--codexctl-reload-probe: 1", "--codexctl-reload-probe: 2"));
  await fixture.call("debug.start", {
    pluginId: "wallpaper", source: path.join(fixture.project, "assets", "wallpapers", "yuugohan-tsuri"), watch: true,
  });
  const debugging = await fixture.current();
  const stable = (await fixture.call("status")).manager.plugins.wallpaper.stable.revision;
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "2");
  await fs.writeFile(compiler, "invalid watched JavaScript\n");
  await waitForLiveCondition(async () => (await fixture.call("status")).manager.lastError);
  assert.equal((await fixture.current()).companion.pid, debugging.companion.pid);
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "2");
  await fs.writeFile(compiler, working.replace("--codexctl-reload-probe: 1", "--codexctl-reload-probe: 3"));
  const watched = await waitForLiveCondition(async () => {
    try {
      const current = await fixture.current();
      return current.companion.pid !== debugging.companion.pid ? current : null;
    } catch { return null; }
  });
  const state = await fixture.call("status");
  assert.equal(state.manager.plugins.wallpaper.debug.watch, true);
  assert.equal(state.manager.plugins.wallpaper.stable.revision, stable);
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "3");
  await fixture.call("debug.stop", { pluginId: "wallpaper" });
  assert.equal(await fixture.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--codexctl-reload-probe").trim()'), "1");
  await fixture.assertSameApp();
  assert.equal(await fixture.evaluate('document.querySelectorAll("#codexctl-wallpaper-v2-style").length'), 1);
  assert.equal(await fixture.evaluate('document.querySelectorAll("#codex-prompt-context-control-host").length'), 1);
  checks.push("debug entry and watch use fresh code; watch recovers from errors; stop restores the baseline");

  console.log("Checking disabled enhancements stay disabled after reload...");
  await fixture.call("master.set", { enabled: false });
  await fixture.cli("live", "reload", "--all");
  assert.equal((await fixture.call("status")).manager.masterEnabled, false);
  assert.equal(await fixture.evaluate('Boolean(window.__CODEXCTL_WALLPAPER_V2__)'), false);
  await fixture.assertSameApp();
  checks.push("master-off state survives full reload without remounting enhancements");
  console.log(JSON.stringify({ caseId: "LIVE-RELOAD-ALL-CODE-001", checks, status: "pass",
    appPid: fixture.app.pid, firstCompanionPid: initial.companion.pid,
    watchedCompanionPid: watched.companion.pid }, null, 2));
} catch (error) {
  const log = await fs.readFile(fixture.paths.liveCompanionLogFile, "utf8").catch(() => "");
  console.error(log.slice(-5000));
  throw error;
} finally { await fixture.close(); }
