import { executorsForLayers } from "../executors.mjs";

const LEVELS = Object.freeze(["L1", "L2", "L3", "L4", "L5"]);
const PLATFORMS = Object.freeze(["all", "macos", "linux"]);

export function defineCase(capability, row) {
  const [id, requirement, scenario, layers, platforms, budgetKey = null] = row;
  return Object.freeze({
    budgetKey,
    capability,
    evidence: Object.freeze([...layers]),
    executors: executorsForLayers(layers),
    id,
    kind: "scenario",
    layers: Object.freeze([...layers]),
    platforms: Object.freeze([...platforms]),
    required: true,
    requirement,
    scenario,
  });
}

export function defineSupplemental(capability, row) {
  const value = defineCase(capability, row);
  return Object.freeze({ ...value, kind: "supplemental", scenario: null });
}

export { LEVELS, PLATFORMS };
