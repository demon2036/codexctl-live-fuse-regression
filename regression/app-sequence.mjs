import { createRunEnvelope } from "./ownership.mjs";
import { discoverTestElectron } from "./electron-runtime.mjs";
import { createElectronAppAdapter } from "./electron-app-adapter.mjs";
import { runAppProbe } from "./app-probe-contract.mjs";
import { launchElectronFixture } from "./electron-runtime.mjs";
import { listProcessRows, readProcessRow } from "../src/desktop-processes.mjs";

const SEQUENCE = Object.freeze([
  Object.freeze({ label: "official", mode: "official" }),
  Object.freeze({ label: "injected-1", mode: "injected" }),
  Object.freeze({ label: "official-ab", mode: "official" }),
  Object.freeze({ label: "injected-2", mode: "injected" }),
  Object.freeze({ label: "injected-repeat", mode: "injected" }),
  Object.freeze({ label: "clean", mode: "official" }),
  Object.freeze({ label: "official-recovery", mode: "official" }),
]);

function push(failures, condition, code) {
  if (condition) failures.push(code);
}

export function evaluateAppSequence(runs, nativeRecovery) {
  const failures = [];
  if (!Array.isArray(runs) || runs.length !== SEQUENCE.length) {
    return { failures: ["sequence-length"], status: "fail" };
  }
  const reference = runs[0]?.result?.identity ?? {};
  const injectedRevisions = [];
  runs.forEach((run, index) => {
    const expected = SEQUENCE[index];
    const result = run?.result ?? {};
    const details = run?.details ?? {};
    push(failures, run?.label !== expected.label || result.mode !== expected.mode,
      `sequence-order-${index}`);
    push(failures, result.status !== "pass", `run-status-${index}`);
    push(failures, result.cleanup?.status !== "pass" || result.cleanup?.orphans?.length !== 0,
      `cleanup-${index}`);
    push(failures, result.remote?.status !== "connected" || result.remote?.errors?.length !== 0,
      `remote-${index}`);
    push(failures, result.processTree?.appServerCount !== 1
      || result.processTree?.controllerCount !== 0
      || result.processTree?.duplicatePresence !== false, `process-tree-${index}`);
    for (const field of ["appVersion", "cliVersion", "profileId"]) {
      push(failures, result.identity?.[field] !== reference[field], `identity-${field}-${index}`);
    }
    if (expected.mode === "injected") {
      push(failures, details.globals?.prompt !== true || details.globals?.wallpaper !== true,
        `injected-globals-${index}`);
      push(failures, details.hostCount !== 1 || details.promptStyleCount !== 1
        || details.wallpaperStyleCount !== 1, `injected-accumulation-${index}`);
      const controlLayout = details.controlLayout ?? {};
      const controls = Array.isArray(controlLayout.controls) ? controlLayout.controls : [];
      const visibleControls = controls.filter((control) => !control.hidden);
      push(failures, controls.length !== 4, `injected-control-count-${index}`);
      push(failures, controls.some((control) => control.hidden) && controlLayout.overflowReachable !== true,
        `injected-overflow-unreachable-${index}`);
      const hostBounds = controlLayout.host;
      push(failures, visibleControls.some(({ bounds }) => !bounds || bounds.width <= 1 || bounds.height <= 1
        || !hostBounds || bounds.left < hostBounds.left - 0.5
        || bounds.right > hostBounds.right + 0.5), `injected-control-bounds-${index}`);
      push(failures, controls.some(({ className }) => !String(className).startsWith("cbps-control cbps-trigger")),
        `injected-control-class-${index}`);
      push(failures, controls.some(({ lineHeight }) => lineHeight !== "18px"),
        `injected-control-line-height-${index}`);
      push(failures, visibleControls.some((entry, controlIndex) => controlIndex > 0
        && entry.bounds.left < visibleControls[controlIndex - 1].bounds.right - 0.5),
      `injected-control-overlap-${index}`);
      push(failures, visibleControls.some((entry, controlIndex) => controlIndex < visibleControls.length - 1
        && entry.bounds.right > visibleControls[controlIndex + 1].bounds.left + 0.5),
      `injected-control-order-${index}`);
      const usageControl = controls.find(({ className }) => (
        String(className).includes("cbps-usage-trigger")
      ));
      push(failures, !usageControl || (!usageControl.hidden && (usageControl.prefixDisplay === "none"
        || usageControl.valueFits !== true)),
      `injected-usage-visibility-${index}`);
      injectedRevisions.push(`${details.promptRevision}:${details.wallpaperRevision}`);
    } else {
      push(failures, details.globals?.prompt !== false || details.globals?.wallpaper !== false,
        `official-globals-${index}`);
      push(failures, details.hostCount !== 0 || details.promptStyleCount !== 0
        || details.wallpaperStyleCount !== 0, `official-dom-${index}`);
    }
  });
  push(failures, new Set(injectedRevisions).size !== 1, "injected-revision-drift");
  const snapshot = nativeRecovery?.snapshot;
  push(failures, nativeRecovery?.profileId !== reference.profileId, "native-recovery-profile");
  push(failures, nativeRecovery?.processBoundary !== true, "native-recovery-process-boundary");
  push(failures, nativeRecovery?.appServerCount !== 1
    || nativeRecovery?.controllerCount !== 0, "native-recovery-process-tree");
  push(failures, nativeRecovery?.cleanup?.status !== "pass"
    || nativeRecovery?.cleanup?.orphans?.length !== 0, "native-recovery-cleanup");
  push(failures, snapshot?.cdp !== false || snapshot?.nodeOptions !== false
    || snapshot?.preloadEnvironment !== false, "native-recovery-launch-state");
  push(failures, snapshot?.renderer?.globals?.prompt !== false
    || snapshot?.renderer?.globals?.wallpaper !== false
    || snapshot?.renderer?.hostCount !== 0
    || snapshot?.renderer?.promptStyleCount !== 0
    || snapshot?.renderer?.wallpaperStyleCount !== 0
    || snapshot?.renderer?.workerCount !== 0, "native-recovery-renderer-state");
  push(failures, snapshot?.renderer?.remote?.status !== "connected"
    || snapshot?.renderer?.remote?.errors?.length !== 0, "native-recovery-remote");
  const unique = [...new Set(failures)];
  return { failures: unique, status: unique.length ? "fail" : "pass" };
}

export async function runElectronAppSequence({
  artifactDir = null,
  exerciseInteractions = false,
} = {}) {
  const envelope = await createRunEnvelope();
  const electron = await discoverTestElectron();
  const runs = [];
  let nativeRecovery = null;
  try {
    for (const step of SEQUENCE) {
      const adapter = createElectronAppAdapter({
        artifactDir,
        artifactLabel: step.label,
        electron,
        envelope,
        exerciseInteractions: exerciseInteractions && step.label === "injected-2",
        mode: step.mode,
      });
      const result = await runAppProbe({ adapter, mode: step.mode, request: {} });
      runs.push({
        details: adapter.details,
        interactions: adapter.interactions,
        label: step.label,
        result,
        screenshot: adapter.screenshot,
      });
    }
    const clean = await launchElectronFixture({ debug: false, electron, envelope });
    const rows = await listProcessRows();
    const controllerCount = rows.filter(({ command }) => (
      command.includes(envelope.root) && /(?:prompt-context|wallpaper-lite)[\\/]injector\.mjs/.test(command)
    )).length;
    const snapshot = await clean.nativeSnapshot();
    const appServerCount = await readProcessRow(clean.ready.appServerPid) ? 1 : 0;
    const cleanup = await clean.close();
    nativeRecovery = {
      appServerCount, cleanup, controllerCount, processBoundary: true,
      profileId: envelope.runId, snapshot,
    };
    const evaluation = evaluateAppSequence(runs, nativeRecovery);
    return {
      schema: "codexctl-app-sequence/1",
      ...evaluation,
      nativeRecovery,
      runs,
    };
  } finally {
    await envelope.cleanup();
  }
}

export { SEQUENCE as APP_SEQUENCE };
