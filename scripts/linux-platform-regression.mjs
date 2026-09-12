#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultConfig } from "../src/defaults.mjs";
import { resolvePaths } from "../src/paths.mjs";
import { discoverDesktop } from "../src/platform.mjs";
import { createRunEnvelope } from "../regression/ownership.mjs";
import { seedIsolatedCodexProfile } from "../regression/codex-profile-fixture.mjs";
import { loginIsolatedLinuxProfile } from "../regression/linux-platform-auth.mjs";
import { runLinuxPlatformMode } from "../regression/linux-platform-runtime.mjs";
import { evaluateLinuxPlatformSequence } from "../regression/linux-platform-sequence.mjs";

const args = process.argv.slice(2);
const help = args.includes("--help");
const json = args.includes("--json");
const unknown = args.filter((arg) => !["--help", "--json"].includes(arg));
if (help) {
  console.log("Usage: linux-platform-regression.mjs [--json]");
  console.log("Runs actual official, injected, and recovery Linux package modes in isolated state.");
  process.exit(0);
}
if (unknown.length) throw new Error("Usage: linux-platform-regression.mjs [--json]");

function finish(result) {
  console.log(json ? JSON.stringify(result) : `Linux platform regression ${result.status}`);
  if (result.status !== "pass") process.exitCode = result.status === "unverified" ? 2 : 1;
}

if (process.platform !== "linux") {
  finish({ actual: false, reasonCodes: ["platform-not-linux"], status: "unverified" });
} else if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  finish({ actual: false, reasonCodes: ["display-unavailable"], status: "unverified" });
} else {
  const apiKey = process.env.CODEXCTL_TEST_OPENAI_API_KEY ?? null;
  delete process.env.CODEXCTL_TEST_OPENAI_API_KEY;
  const envelope = await createRunEnvelope();
  try {
    const prompt = path.join(envelope.runtime, "developer-prompt.md");
    await fs.writeFile(prompt, "isolated Linux regression prompt\n", { mode: 0o600 });
    const config = createDefaultConfig();
    config.modules = { context: true, prompt: true, wallpaper: true };
    config.prompt.profiles = [{ id: "work", label: "Work", path: prompt }];
    if (process.env.CODEXCTL_TEST_LINUX_APP) {
      config.app.path = process.env.CODEXCTL_TEST_LINUX_APP;
    }
    const env = {
      ...process.env,
      CODEX_HOME: path.join(envelope.root, "codex-home"),
      CODEXCTL_HOME: path.join(envelope.runtime, "controller"),
      HOME: envelope.root,
      XDG_CACHE_HOME: path.join(envelope.root, "xdg-cache"),
      XDG_CONFIG_HOME: path.join(envelope.root, "xdg-config"),
      XDG_DATA_HOME: path.join(envelope.root, "xdg-data"),
      XDG_STATE_HOME: path.join(envelope.root, "xdg-state"),
    };
    const paths = resolvePaths(env);
    const desktop = await discoverDesktop(config, env, "linux");
    // Index a project, not the changing Electron profile and app-server state.
    const workspace = path.join(envelope.root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    const offlineAuthentication = await loginIsolatedLinuxProfile({
      cli: desktop.officialCli, codexHome: env.CODEX_HOME, env,
    });
    const profileFixture = await seedIsolatedCodexProfile({
      cli: desktop.officialCli, codexHome: env.CODEX_HOME,
      cwd: workspace, env,
    });
    const authentication = apiKey ? await loginIsolatedLinuxProfile({
      apiKey, cli: desktop.officialCli, codexHome: env.CODEX_HOME, env,
    }) : offlineAuthentication;
    const official = await runLinuxPlatformMode({ config, envelope, env, mode: "official", paths, workspace });
    const injected = await runLinuxPlatformMode({ config, envelope, env, mode: "injected", paths, workspace });
    const recovery = await runLinuxPlatformMode({ config, envelope, env, mode: "official", paths, workspace });
    const sequence = evaluateLinuxPlatformSequence({ official, injected, recovery });
    finish({
      schema: "codexctl-linux-platform/2",
      actual: true,
      authentication,
      profileFixture,
      status: sequence.status,
      reasonCodes: sequence.reasonCodes,
      cleanup: {
        orphans: [...official.cleanup.orphans, ...injected.cleanup.orphans,
          ...recovery.cleanup.orphans],
        status: [official, injected, recovery].every(({ cleanup }) => cleanup.status === "pass")
          ? "pass" : "fail",
      },
      modes: { official, injected, recovery },
      performance: sequence.performance,
      processBoundary: !sequence.failures.includes("recovery-process-boundary"),
    });
  } finally {
    await envelope.cleanup();
  }
}
