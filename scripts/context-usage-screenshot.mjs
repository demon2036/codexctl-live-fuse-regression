#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { materializeRuntime } from "../src/runtime.mjs";
import { installOnce } from "../src/one-shot-injection.mjs";
import { createRunEnvelope } from "../regression/ownership.mjs";
import { launchElectronFixture } from "../regression/electron-runtime.mjs";
import {
  captureRedactedScreenshot,
  waitForInjectedModules,
  withAppSession,
} from "../regression/app-cdp.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.argv[2] ?? path.join(projectRoot, "regression-results", "context-usage-panel.png"),
);
const fixtureHeight = Number(process.env.CODEXCTL_USAGE_FIXTURE_HEIGHT ?? 800);
const fixtureWidth = Number(process.env.CODEXCTL_USAGE_FIXTURE_WIDTH ?? 971);
const anomalyUsage = process.env.CODEXCTL_USAGE_FIXTURE_ANOMALY === "1";
if (!Number.isInteger(fixtureHeight) || fixtureHeight < 480 || fixtureHeight > 2160) {
  throw new Error(`invalid CODEXCTL_USAGE_FIXTURE_HEIGHT: ${fixtureHeight}`);
}
if (!Number.isInteger(fixtureWidth) || fixtureWidth < 760 || fixtureWidth > 3840) {
  throw new Error(`invalid CODEXCTL_USAGE_FIXTURE_WIDTH: ${fixtureWidth}`);
}
const envelope = await createRunEnvelope();
let fixture = null;

try {
  const prompt = path.join(envelope.runtime, "usage-fixture-prompt.md");
  await fs.writeFile(prompt, "isolated usage fixture prompt\n", { mode: 0o600 });
  const config = createDefaultConfig();
  config.modules = { context: true, prompt: true, wallpaper: false };
  config.prompt.profiles = [{ id: "work", label: "Work", path: prompt }];
  const paths = resolvePaths({
    HOME: envelope.root,
    CODEXCTL_HOME: path.join(envelope.runtime, "controller"),
  });
  const runtime = await materializeRuntime(config, paths);

  fixture = await launchElectronFixture({ envelope, height: fixtureHeight, width: fixtureWidth });
  await withAppSession(fixture.port, (session) => session.evaluate(`(() => {
    document.getElementById('sidebar').style.display = 'none';
    return { width: window.innerWidth, height: window.innerHeight };
  })()`));
  if (anomalyUsage) {
    await withAppSession(fixture.port, (session) => session.evaluate(
      "window.__CODEXCTL_REGRESSION_APP__.setUsage(258400, 400000)",
    ));
  }
  await installOnce(paths, config, runtime, fixture.port);
  await waitForInjectedModules(fixture.port, {
    context: true,
    prompt: true,
    wallpaper: false,
  });
  const panel = await withAppSession(fixture.port, async (session) => {
    const result = await session.evaluate(`(() => {
      const trigger = document.querySelector('[data-codex-context-usage-trigger="true"]');
      if (!trigger) throw new Error("usage-trigger-missing");
      const more = document.querySelector('[data-codex-control-overflow-trigger="true"]');
      if (!more) throw new Error("more-trigger-missing");
      const host = document.getElementById('codex-prompt-context-control-host');
      const nativeContext = document.getElementById('native-context');
      const nativeSend = document.getElementById('native-send');
      const geometry = (element) => {
        const rect = element.getBoundingClientRect();
        const label = element.querySelector('.cbps-label');
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          text: element.textContent.replace(/\\s+/g, ' ').trim(),
          display: getComputedStyle(element).display,
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height,
          labelClientWidth: label?.clientWidth ?? null,
          labelScrollWidth: label?.scrollWidth ?? null,
          hit: hit === element || element.contains(hit),
        };
      };
      more.click();
      const overflow = document.querySelector('[data-codex-control-overflow-menu="true"]');
      if (!overflow) throw new Error("overflow-menu-missing");
      const overflowTargets = [...overflow.querySelectorAll('[data-codex-overflow-target]')]
        .map((item) => item.getAttribute('data-codex-overflow-target'));
      more.click();
      trigger.click();
      const panel = document.querySelector('[data-codex-context-usage-panel="true"]');
      if (!panel) throw new Error("usage-panel-missing");
      const bounds = panel.getBoundingClientRect();
      const value = trigger.querySelector('.cbps-label-value');
      const prefix = trigger.querySelector('.cbps-label-prefix');
      const style = getComputedStyle(panel);
      const diagnostics = window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
      const roleRows = [...panel.querySelectorAll('.cbps-usage-source-row')].map((row) => {
        const rect = row.getBoundingClientRect();
        const label = row.querySelector('.cbps-usage-row-label');
        const value = row.querySelector('.cbps-usage-row-value');
        return {
          label: label?.textContent.trim() ?? '',
          value: value?.textContent.trim() ?? '',
          top: rect.top,
          bottom: rect.bottom,
          valueFits: (value?.scrollWidth ?? 1) <= (value?.clientWidth ?? 0),
        };
      });
      return {
        bounds: {
          bottom: bounds.bottom,
          height: bounds.height,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          width: bounds.width,
        },
        sourceMode: panel.getAttribute("data-source-mode"),
        roleMode: panel.getAttribute("data-role-mode"),
        text: panel.textContent.replace(/\\s+/g, " ").trim(),
        density: host.getAttribute('data-cbps-density'),
        controls: {
          usage: geometry(trigger),
          more: geometry(more),
          base: geometry(document.querySelector('[data-codex-base-prompt-trigger="true"]')),
          context: geometry(document.querySelector('[data-codex-context-window-trigger="true"]')),
          provider: geometry(document.querySelector('[data-codex-provider-indicator="true"]')),
          nativeContext: geometry(nativeContext),
          nativeSend: geometry(nativeSend),
          hostRight: host.getBoundingClientRect().right,
        },
        overflowTargets,
        roleRows,
        viewport: {
          height: window.innerHeight,
          panelClientHeight: panel.clientHeight,
          panelScrollHeight: panel.scrollHeight,
          panelOverflowY: style.overflowY,
        },
        usageChip: {
          prefixDisplay: prefix ? getComputedStyle(prefix).display : null,
          text: trigger.textContent,
          valueClientWidth: value?.clientWidth ?? null,
          valueScrollWidth: value?.scrollWidth ?? null,
        },
        usageButtonCount: diagnostics.usageButtonCount,
        activeTimers: diagnostics.activeTimers,
        fixtureCounters: window.__CODEXCTL_REGRESSION_APP__.counters,
      };
    })()`);
    const expectedRoles = [
      "System", "Developer", "User", "Assistant", "Tool", "Reasoning",
      "Tool definitions", "Unclassified",
    ];
    if (result.usageButtonCount !== 1 || result.sourceMode !== "exact"
      || result.roleMode !== "estimated" || result.density !== "tight") {
      throw new Error(`usage fixture did not stabilize: ${JSON.stringify(result)}`);
    }
    if (result.usageChip.prefixDisplay === "none"
      || result.usageChip.valueClientWidth < result.usageChip.valueScrollWidth
      || result.controls.usage.display === "none" || result.controls.more.display === "none"
      || result.controls.base.display !== "none" || result.controls.context.display !== "none"
      || result.controls.provider.display !== "none"
      || !result.controls.usage.hit || !result.controls.more.hit
      || !result.controls.nativeContext.hit || !result.controls.nativeSend.hit
      || result.controls.usage.labelClientWidth < result.controls.usage.labelScrollWidth
      || result.controls.more.labelClientWidth < result.controls.more.labelScrollWidth
      || result.controls.hostRight > result.controls.nativeContext.left - 4
      || JSON.stringify(result.overflowTargets) !== JSON.stringify([
        "base-prompt", "context-window", "provider",
      ])
      || JSON.stringify(result.roleRows.map(({ label }) => label)) !== JSON.stringify(expectedRoles)
      || result.roleRows.some(({ value, valueFits }) => !valueFits || !/^[0-9,]+ · [0-9.]+%$/.test(value))
      || result.roleRows.some(({ top, bottom }) => top < result.bounds.top || bottom > result.bounds.bottom)
      || result.bounds.top < 0 || result.bounds.bottom > result.viewport.height + 1
      || result.viewport.panelScrollHeight > result.viewport.panelClientHeight) {
      throw new Error(`usage fixture is clipped: ${JSON.stringify(result)}`);
    }
    if (Object.values(result.activeTimers).some((count) => count !== 0)
      || result.fixtureCounters.intervals !== 0
      || result.fixtureCounters.mutationObservers !== 0
      || result.fixtureCounters.resizeObservers !== 0) {
      throw new Error(`usage fixture violated the zero-background-work contract: ${JSON.stringify(result)}`);
    }
    return result;
  });
  const screenshot = await captureRedactedScreenshot(fixture.port, output);
  console.log(JSON.stringify({
    fixtureProfile: envelope.profile,
    isolated: true,
    panel,
    screenshot: { ...screenshot, path: output },
  }, null, 2));
} finally {
  if (fixture) await fixture.close();
  await envelope.cleanup();
}
