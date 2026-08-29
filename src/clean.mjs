import { launchManagedApp } from "./app-transaction.mjs";
import { uninstallAutoInject } from "./auto-inject.mjs";
import { discoverDesktop } from "./platform.mjs";
import {
  listDesktopProcesses,
  remoteDebuggingPort,
  terminateDetachedDesktopHelpers,
  terminateDesktopProcess,
  terminateProfileCrashHandlers,
} from "./desktop-processes.mjs";
import { readManagedLaunches, removeManagedLaunch } from "./launches.mjs";
import { terminateOwnedWorkers } from "./owned-processes.mjs";
import { updateRuntimeConfig } from "./runtime.mjs";
import { stopSupervisor } from "./supervisor.mjs";

export async function cleanController(paths, {
  env = process.env,
  platform = process.platform,
  keepPrimaryApp = true,
} = {}) {
  const { config } = await updateRuntimeConfig(paths, (draft) => {
    draft.modules.prompt = false;
    draft.modules.context = false;
    draft.modules.wallpaper = false;
    draft.app.debugPort = 0;
  });
  const automatic = await uninstallAutoInject(paths, platform).catch((error) => ({ error: error.message }));
  const supervisor = await stopSupervisor(paths).catch((error) => ({ error: error.message }));
  const orphanWorkers = await terminateOwnedWorkers(paths);
  const desktop = await discoverDesktop(config, env, platform);
  const managedBefore = await readManagedLaunches(paths, desktop, { prune: true });

  const closedIsolated = [];
  const closedIsolatedHelpers = [];
  const processSnapshot = await listDesktopProcesses(desktop);
  for (const record of managedBefore.filter((entry) => entry.isolatedProfile)) {
    const processInfo = processSnapshot.find((entry) => entry.pid === record.pid
      && entry.startedAt === record.startedAt);
    if (!processInfo) continue;
    const stopped = await terminateDesktopProcess(processInfo, desktop, 5000);
    if (stopped) {
      closedIsolatedHelpers.push(
        ...await terminateProfileCrashHandlers(record.isolatedProfile, desktop).catch(() => []),
      );
      await removeManagedLaunch(paths, record.pid).catch(() => {});
      closedIsolated.push(record.pid);
    }
  }

  let app = { action: "none" };
  const managedPrimary = managedBefore.find((record) => !record.isolatedProfile);
  if (keepPrimaryApp && managedPrimary?.injection?.enabled) {
    app = await launchManagedApp({
      paths,
      config,
      relay: { enabled: false, values: {} },
      options: { inject: false },
      env,
      platform,
    });
  }

  // Isolated test Apps are never converted into a primary official session.
  // Only exact managed records were closed above; unknown processes are never
  // signalled and remain visible in the report below.
  const processes = await listDesktopProcesses(desktop);
  const detachedDesktopHelpers = await terminateDetachedDesktopHelpers(desktop).catch(() => []);
  const unknownDebugProcesses = [];
  for (const processInfo of processes) {
    const port = remoteDebuggingPort(processInfo.command);
    if (!port) continue;
    if (!managedBefore.some((record) => record.pid === processInfo.pid
      && record.startedAt === processInfo.startedAt)) {
      unknownDebugProcesses.push({ pid: processInfo.pid, port });
    }
  }

  return {
    modules: config.modules,
    automatic,
    supervisor,
    orphanWorkers,
    closedIsolated,
    closedIsolatedHelpers,
    detachedDesktopHelpers,
    app: {
      action: app.action,
      pid: app.processInfo?.pid ?? null,
    },
    unknownDebugProcesses,
  };
}
