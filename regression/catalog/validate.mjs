import { LEVELS, PLATFORMS } from "./define.mjs";

const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/;

function issue(code, message, id = null) {
  return Object.freeze({ code, id, message });
}

export function validateCatalog({
  budgetKeys = new Set(),
  cases = [],
  executorIds = new Set(),
  registeredTestIds = new Set(),
}) {
  const errors = [];
  const knownIds = new Set();
  const allowedLevels = new Set(LEVELS);
  const allowedPlatforms = new Set(PLATFORMS);

  for (const entry of cases) {
    const id = String(entry?.id ?? "<missing>");
    if (!ID_PATTERN.test(id)) errors.push(issue("invalid-id", `非法 case ID：${id}`, id));
    if (knownIds.has(id)) errors.push(issue("duplicate-id", `重复 case ID：${id}`, id));
    knownIds.add(id);

    for (const layer of entry?.layers ?? []) {
      if (!allowedLevels.has(layer)) errors.push(issue("invalid-level", `非法层级 ${layer}：${id}`, id));
    }
    for (const platform of entry?.platforms ?? []) {
      if (!allowedPlatforms.has(platform)) {
        errors.push(issue("invalid-platform", `非法平台 ${platform}：${id}`, id));
      }
    }
    if (entry?.budgetKey && !budgetKeys.has(entry.budgetKey)) {
      errors.push(issue("unknown-budget", `未知预算 ${entry.budgetKey}：${id}`, id));
    }

    const executors = Array.isArray(entry?.executors) ? entry.executors : [];
    if (executors.length === 0) errors.push(issue("missing-executor", `缺少执行入口：${id}`, id));
    const coveredLayers = new Set();
    for (const executor of executors) {
      coveredLayers.add(executor?.layer);
      if (!executorIds.has(executor?.id)) {
        errors.push(issue(
          "unknown-executor",
          `执行入口不存在 ${String(executor?.id)}：${id}`,
          id,
        ));
      }
      if (!entry.layers?.includes(executor?.layer)) {
        errors.push(issue(
          "executor-level",
          `执行入口层级 ${String(executor?.layer)} 不属于 case：${id}`,
          id,
        ));
      }
    }
    for (const layer of entry?.layers ?? []) {
      if (!coveredLayers.has(layer)) {
        errors.push(issue("uncovered-level", `层级 ${layer} 缺少执行入口：${id}`, id));
      }
    }
    if (entry?.required === true && !registeredTestIds.has(id)) {
      errors.push(issue("missing-test", `必选 case 没有测试：${id}`, id));
    }
  }

  for (const id of registeredTestIds) {
    if (!knownIds.has(id)) errors.push(issue("orphan-test", `孤立核心测试：${id}`, id));
  }
  return errors;
}
