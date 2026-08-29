import { compactCpuEvidence } from "./performance-evidence.mjs";

const PHASES = Object.freeze(["input", "stream"]);
const COMPONENTS = Object.freeze({
  controls: Object.freeze({
    modules: Object.freeze({ context: true, prompt: true, wallpaper: false }),
    phases: PHASES,
  }),
  wallpaper: Object.freeze({
    modules: Object.freeze({ context: false, prompt: false, wallpaper: true }),
    phases: PHASES,
  }),
});

export function performanceComponentNames() {
  return Object.keys(COMPONENTS);
}

export function resolvePerformanceComponent(name) {
  const value = COMPONENTS[name];
  if (!value) throw new Error(`Unknown performance component: ${String(name)}`);
  return value;
}

export function buildPerformanceComponentSummary({ component, cpu, source } = {}) {
  resolvePerformanceComponent(component);
  if (!/^[0-9a-f]{40}$/.test(source?.revision ?? "")
    || typeof source?.dirty !== "boolean") {
    throw new Error("Performance component source requires a full revision and dirty state");
  }
  const evidence = compactCpuEvidence(cpu);
  return {
    schema: "codexctl-performance-component/1",
    component,
    ...source,
    status: evidence.status,
    cpu: evidence,
  };
}
