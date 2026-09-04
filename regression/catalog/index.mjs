import { appConfigLaunchCases } from "./app-config-launch.mjs";
import { appRendererCases } from "./app-renderer.mjs";
import { appPerformancePlatformCases } from "./app-performance-platform.mjs";
import { tddCases } from "./tdd-cases.mjs";

export const regressionCases = Object.freeze([
  ...appConfigLaunchCases,
  ...appRendererCases,
  ...appPerformancePlatformCases,
  ...tddCases,
]);

export const regressionCaseById = new Map(regressionCases.map((entry) => [entry.id, entry]));
