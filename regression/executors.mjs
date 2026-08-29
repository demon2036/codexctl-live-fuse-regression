const DEFINITIONS = Object.freeze({
  L1: Object.freeze({ command: "npm run test:fast", id: "fast-l1", layer: "L1" }),
  L2: Object.freeze({ command: "npm run test:fast", id: "fast-l2", layer: "L2" }),
  L3: Object.freeze({ command: "npm run test:browser", id: "browser-l3", layer: "L3" }),
  L4: Object.freeze({ command: "npm run test:app", id: "app-l4", layer: "L4" }),
  L5: Object.freeze({ command: "npm run test:platform", id: "platform-l5", layer: "L5" }),
});

export function executorsForLayers(layers) {
  return Object.freeze(layers.map((layer) => DEFINITIONS[layer]));
}

export const REGRESSION_EXECUTORS = Object.freeze(Object.values(DEFINITIONS));
export const REGRESSION_EXECUTOR_IDS = new Set(REGRESSION_EXECUTORS.map(({ id }) => id));
