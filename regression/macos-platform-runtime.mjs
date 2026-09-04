import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import {
  descendantProcessRows,
  listProcessRows,
  readProcessRow,
  terminateDesktopProcess,
  terminateProfileCrashHandlers,
  terminateProcessSnapshots,
} from "../src/desktop-processes.mjs";
import { sanitizedBaseEnvironment } from "../src/relay.mjs";
import { launchServicesArguments } from "../src/platform.mjs";
import { assertSafeProfile, registerOwnedProcess, verifyOwnedProcess } from "./ownership.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function exactExecutable(row, executable) {
  return row.command === executable || row.command.startsWith(`${executable} `);
}

function profileArgument(command, profile) {
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)--user-data-dir(?:=|\\s+)${escaped}(?:\\s|$)`).test(command);
}

export function ownedEnvelopeProcessRows(rows, root) {
  const prefix = `${path.resolve(root)}${path.sep}`;
  return rows.filter((row) => String(row.command).includes(prefix));
}

async function drainOwnedEnvelopeProcesses({ root, rows }) {
  let emptyPasses = 0;
  for (let pass = 0; pass < 6 && emptyPasses < 2; pass += 1) {
    const owned = ownedEnvelopeProcessRows(await rows(), root);
    if (owned.length) {
      emptyPasses = 0;
      await terminateProcessSnapshots(owned, 1500);
    } else emptyPasses += 1;
    await wait(80);
  }
  return ownedEnvelopeProcessRows(await rows(), root);
}

function processHasEnvironment(pid, key, value) {
  try {
    const output = execFileSync("/bin/ps", ["eww", "-p", String(pid), "-o", "command="], {
      encoding: "utf8", timeout: 3000, maxBuffer: 4 * 1024 * 1024,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    });
    return output.includes(` ${key}=${value} `) || output.trimEnd().endsWith(` ${key}=${value}`);
  } catch {
    return null;
  }
}

export function macLaunchServicesContract({ bundle, environment, executable, mode, openArgs, profile }) {
  const failures = [];
  const push = (condition, code) => { if (condition) failures.push(code); };
  push(!path.isAbsolute(bundle ?? "") || !bundle.endsWith(".app"), "bundle-path");
  push(!path.isAbsolute(executable ?? "") || !executable.startsWith(`${bundle}${path.sep}`),
    "embedded-executable");
  const bundleIndex = openArgs?.lastIndexOf(bundle) ?? -1;
  const trailing = bundleIndex < 0 ? [] : openArgs.slice(bundleIndex + 1);
  const safeIsolation = trailing.length === 2 && trailing[0] === "--args"
    && trailing[1] === `--user-data-dir=${profile}`;
  push(bundleIndex < 0 || (trailing.length > 0 && !safeIsolation)
    || openArgs.includes("-g") || openArgs.includes("-W") || !openArgs.includes("-n")
    || openArgs.slice(0, bundleIndex).includes("--args"), "launch-services-arguments");
  push(Object.keys(environment ?? {}).some((key) => /REMOTE_DEBUGGING/i.test(key)),
    "debug-environment");
  push(mode === "official" && (environment?.NODE_OPTIONS
    || environment?.CODEXCTL_PRELOAD_SPEC || environment?.CODEXCTL_PRELOAD_RESULT),
    "official-preload-environment");
  push(mode === "injected" && (!environment?.NODE_OPTIONS
    || !environment?.CODEXCTL_PRELOAD_SPEC || !environment?.CODEXCTL_PRELOAD_RESULT),
    "injected-preload-environment");
  return { failures, status: failures.length ? "fail" : "pass" };
}

function launchEnvironment({ embeddedCli, envelope, preload }) {
  const environment = {
    ...sanitizedBaseEnvironment(process.env),
    CODEX_CLI_PATH: embeddedCli,
    CODEX_HOME: path.join(envelope.root, "codex-home"),
    CODEXCTL_OFFICIAL_CLI: embeddedCli,
    CODEX_ELECTRON_USER_DATA_PATH: envelope.profile,
  };
  if (preload) {
    environment.NODE_OPTIONS = `--require=${JSON.stringify(preload.hook)}`;
    environment.CODEXCTL_PRELOAD_SPEC = preload.spec;
    environment.CODEXCTL_PRELOAD_RESULT = preload.result;
  }
  return environment;
}

async function discoverNewMain({ baselinePids, deadline, executable, rows }) {
  let last = [];
  while (Date.now() < deadline) {
    last = (await rows()).filter((row) => (
      exactExecutable(row, executable) && !baselinePids.has(row.pid)
    ));
    if (last.length === 1) return last[0];
    if (last.length > 1) throw new Error("isolated LaunchServices created multiple main processes");
    await wait(50);
  }
  throw new Error(`isolated LaunchServices main process deadline; observed=${last.length}`);
}

async function waitForProfileFamily({ deadline, main, profile, rows }) {
  let family = [];
  while (Date.now() < deadline) {
    const all = await rows();
    family = descendantProcessRows(all, main.pid);
    if (family.some((row) => profileArgument(row.command, profile))) return { all, family };
    await wait(50);
  }
  const profileRows = family.filter(({ command }) => command.includes("--user-data-dir"));
  const containsCanonicalProfile = profileRows.some(({ command }) => command.includes(profile));
  throw new Error(
    `isolated App did not bind the owned profile; family=${family.length}; `
    + `userDataRows=${profileRows.length}; canonicalMatch=${containsCanonicalProfile}`,
  );
}

function processEvidence(main, family, embeddedCli, profile) {
  const appServers = family.filter(({ command }) => (
    (command === `${embeddedCli} app-server` || command.startsWith(`${embeddedCli} `))
    && /(?:^|\s)app-server(?:\s|$)/.test(command)
  ));
  return {
    appServerCount: appServers.length,
    appServerPids: appServers.map(({ pid }) => pid),
    appArguments: main.command === main.executable ? [] : main.command.split(" ").slice(1),
    profileBound: family.some((row) => profileArgument(row.command, profile)),
    remoteDebugging: family.some(({ command }) => /--remote-debugging-(?:address|port)/.test(command)),
  };
}

export async function launchIsolatedMacApp({
  bundle,
  embeddedCli,
  envelope,
  executable,
  mode = "official",
  preload = null,
  protectedPids = new Set(),
  spawnImpl = spawn,
  rows = listProcessRows,
  readProcess = readProcessRow,
  terminate = terminateDesktopProcess,
  terminateCrashHandlers = terminateProfileCrashHandlers,
  timeoutMs = 20_000,
} = {}) {
  if (!new Set(["official", "injected"]).has(mode)) throw new Error(`invalid macOS mode: ${mode}`);
  assertSafeProfile(envelope.profile, { envelope });
  for (const filename of [bundle, executable, embeddedCli]) await fs.access(filename);
  const baselinePids = new Set((await rows())
    .filter((row) => exactExecutable(row, executable)).map(({ pid }) => pid));
  for (const pid of baselinePids) protectedPids.add(pid);
  const environment = launchEnvironment({ embeddedCli, envelope, preload });
  await fs.mkdir(environment.CODEX_HOME, { recursive: true, mode: 0o700 });
  const openArgs = [...launchServicesArguments({
    desktop: { bundle }, environment,
  }, ["-n"]), "--args", `--user-data-dir=${envelope.profile}`];
  const contract = macLaunchServicesContract({
    bundle, environment, executable, mode, openArgs, profile: envelope.profile,
  });
  if (contract.status !== "pass") throw new Error(`invalid macOS launch contract: ${contract.failures}`);
  const opener = spawnImpl("/usr/bin/open", openArgs, {
    env: environment, stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  opener.stderr?.setEncoding?.("utf8");
  opener.stderr?.on?.("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
  const deadline = Date.now() + timeoutMs;
  let main;
  let closed = false;
  try {
    main = await discoverNewMain({ baselinePids, deadline, executable, rows });
    if (protectedPids.has(main.pid)) throw new Error(`protected primary PID ${main.pid}`);
    registerOwnedProcess(envelope, main);
    const current = await readProcess(main.pid);
    verifyOwnedProcess(envelope, current, main.pid);
    const profileEnvironment = processHasEnvironment(
      main.pid, "CODEX_ELECTRON_USER_DATA_PATH", envelope.profile,
    );
    if (profileEnvironment === false) {
      throw new Error("LaunchServices did not deliver the explicit profile environment");
    }
    const observed = await waitForProfileFamily({ deadline, main, profile: envelope.profile, rows });
    const evidence = processEvidence(
      { ...main, executable }, observed.family, embeddedCli, envelope.profile,
    );
    if (!evidence.profileBound || evidence.remoteDebugging) {
      throw new Error("isolated App process contract failed");
    }
    return {
      contract,
      environmentKeys: Object.keys(environment).filter((key) => key.startsWith("CODEX") || key === "NODE_OPTIONS").sort(),
      evidence,
      main,
      async close() {
        if (closed) return { orphans: [], status: "pass" };
        closed = true;
        const currentMain = await readProcess(main.pid);
        if (currentMain) {
          verifyOwnedProcess(envelope, currentMain, main.pid);
          await terminate(main, { bundle, executable, platform: "darwin" }, 8000);
        }
        await terminateCrashHandlers(envelope.profile, { bundle, executable, platform: "darwin" });
        if (opener.exitCode === null && opener.signalCode === null) opener.kill("SIGTERM");
        const ownedRemaining = await drainOwnedEnvelopeProcesses({
          root: envelope.root, rows,
        });
        const all = await rows();
        const remaining = [...new Map([
          ...ownedRemaining,
          ...all.filter((row) => profileArgument(row.command, envelope.profile)),
        ].map((row) => [row.pid, row])).values()];
        return {
          orphans: remaining.map(({ pid }) => ({ kind: "macos-isolated", pid })),
          status: remaining.length ? "fail" : "pass",
        };
      },
    };
  } catch (error) {
    if (main && await readProcess(main.pid).catch(() => null)) {
      await terminate(main, { bundle, executable, platform: "darwin" }, 5000).catch(() => false);
    }
    await terminateCrashHandlers(envelope.profile, { bundle, executable, platform: "darwin" })
      .catch(() => []);
    if (opener.exitCode === null && opener.signalCode === null) opener.kill("SIGTERM");
    throw new Error(`${error.message}${stderr ? `; open: ${stderr}` : ""}`);
  }
}
