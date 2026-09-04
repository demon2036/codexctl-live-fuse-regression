import path from "node:path";

const SUMMARY_FIELDS = [
  "schema", "runId", "revision", "dirty", "status", "startedAt", "completedAt",
  "environment", "ownership", "counts", "cases", "cleanup",
];
const ENVIRONMENT_FIELDS = [
  "appVersion", "arch", "chromiumVersion", "cliVersion", "nodeVersion", "os",
];
const OWNERSHIP_FIELDS = ["appPids", "ports", "profileId"];
const COUNT_FIELDS = ["blocked", "fail", "invalid", "pass", "unverified"];
const CASE_FIELDS = [
  "durationMs", "evidence", "id", "layer", "metrics", "platform", "reasonCode", "status",
];
const CLEANUP_FIELDS = ["orphans", "status"];
const ORPHAN_FIELDS = ["kind", "pid"];
const SUMMARY_STATUSES = new Set(["pass", "fail", "unverified", "blocked", "invalid"]);
const CASE_STATUSES = new Set(SUMMARY_STATUSES);
const CLEANUP_STATUSES = new Set(["pass", "fail"]);
const LAYERS = new Set(["L1", "L2", "L3", "L4", "L5"]);
const PLATFORMS = new Set(["all", "macos", "linux"]);
const METRIC_FIELDS = new Set([
  "cpuMedianDeltaPoints", "cpuP95DeltaPoints", "durationMs", "ensureSchedules",
  "inputMaxMs", "inputP50Ms", "inputP95Ms", "layoutDurationMs", "layoutReads",
  "launchMedianDeltaMs", "launchP95DeltaMs", "longTaskCount", "mutationCount",
  "observerCount", "positionPasses", "reconcileCount", "remoteConnected",
  "scriptDurationMs", "scrollMaxMs", "scrollP50Ms", "scrollP95Ms",
  "styleDurationMs", "timerCount", "visibleP95DeltaMs", "workerCount",
]);
const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

function issue(code, message, field = null) {
  return Object.freeze({ code, field, message });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateExactObject(value, fields, label, errors) {
  if (!isRecord(value)) {
    errors.push(issue("invalid-type", `${label} 必须是对象`, label));
    return false;
  }
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      errors.push(issue("missing-field", `${label} 缺少字段：${field}`, field));
    }
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(issue("unknown-field", `${label} 未知字段：${field}`, field));
  }
  return true;
}

function isSafeRelative(filename) {
  if (typeof filename !== "string" || filename.length === 0 || filename.includes("\0")) return false;
  if (path.isAbsolute(filename) || /^[A-Za-z]:[\\/]/.test(filename)) return false;
  const normalized = filename.replaceAll("\\", "/");
  return !normalized.split("/").includes("..") && normalized !== ".";
}

function validateString(value, label, errors, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    errors.push(issue("invalid-string", `${label} 必须是${allowEmpty ? "" : "非空"}字符串`, label));
  }
}

function validateFiniteNumber(value, label, errors, { integer = false, minimum = 0 } = {}) {
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) {
    errors.push(issue("invalid-number", `${label} 必须是${integer ? "安全整数" : "有限数字"}`, label));
  }
}

function validateEnvironment(environment, errors) {
  if (!validateExactObject(environment, ENVIRONMENT_FIELDS, "environment", errors)) return;
  for (const field of ENVIRONMENT_FIELDS) validateString(environment[field], `environment.${field}`, errors);
}

function validateOwnership(ownership, errors) {
  if (!validateExactObject(ownership, OWNERSHIP_FIELDS, "ownership", errors)) return;
  for (const field of ["appPids", "ports"]) {
    if (!Array.isArray(ownership[field])) {
      errors.push(issue("invalid-type", `ownership.${field} 必须是数组`, field));
      continue;
    }
    for (const value of ownership[field]) {
      validateFiniteNumber(value, `ownership.${field}`, errors, { integer: true, minimum: 1 });
    }
  }
  if (typeof ownership.profileId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(ownership.profileId)) {
    errors.push(issue("invalid-profile-id", "ownership.profileId 必须是安全的相对标识", "profileId"));
  }
}

function validateCounts(counts, errors) {
  if (!validateExactObject(counts, COUNT_FIELDS, "counts", errors)) return;
  for (const field of COUNT_FIELDS) {
    validateFiniteNumber(counts[field], `counts.${field}`, errors, { integer: true });
  }
}

function validateMetrics(metrics, label, errors) {
  if (!isRecord(metrics)) {
    errors.push(issue("invalid-type", `${label} 必须是对象`, "metrics"));
    return;
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (!METRIC_FIELDS.has(key)) {
      errors.push(issue("unknown-metric", `${label} 未知指标：${key}`, key));
    } else if (!(value === null || typeof value === "boolean" || Number.isFinite(value))) {
      errors.push(issue("invalid-metric", `${label}.${key} 必须是有限数字、布尔值或 null`, key));
    }
  }
}

function validateCase(entry, index, errors) {
  const label = `cases[${index}]`;
  if (!validateExactObject(entry, CASE_FIELDS, label, errors)) return;
  validateFiniteNumber(entry.durationMs, `${label}.durationMs`, errors);
  if (!Array.isArray(entry.evidence)) {
    errors.push(issue("invalid-type", `${label}.evidence 必须是数组`, "evidence"));
  } else {
    for (const filename of entry.evidence) {
      if (!isSafeRelative(filename)) {
        errors.push(issue("unsafe-path", `${label}.evidence 必须使用安全相对路径：${String(filename)}`, "evidence"));
      }
    }
  }
  if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
    errors.push(issue("invalid-case-id", `${label}.id 非法：${String(entry.id)}`, "id"));
  }
  if (!LAYERS.has(entry.layer)) errors.push(issue("invalid-layer", `${label}.layer 非法：${entry.layer}`, "layer"));
  if (!PLATFORMS.has(entry.platform)) {
    errors.push(issue("invalid-platform", `${label}.platform 非法：${entry.platform}`, "platform"));
  }
  if (!CASE_STATUSES.has(entry.status)) {
    errors.push(issue("invalid-case-status", `非法 case 状态：${String(entry.status)}`, "status"));
  }
  if (!(entry.reasonCode === null || /^[a-z][a-z0-9-]{1,79}$/.test(entry.reasonCode))) {
    errors.push(issue("invalid-reason", `${label}.reasonCode 必须是 null 或稳定原因码`, "reasonCode"));
  }
  validateMetrics(entry.metrics, `${label}.metrics`, errors);
}

function validateCleanup(cleanup, errors) {
  if (!validateExactObject(cleanup, CLEANUP_FIELDS, "cleanup", errors)) return;
  if (!CLEANUP_STATUSES.has(cleanup.status)) {
    errors.push(issue("invalid-cleanup-status", `cleanup.status 非法：${cleanup.status}`, "status"));
  }
  if (!Array.isArray(cleanup.orphans)) {
    errors.push(issue("invalid-type", "cleanup.orphans 必须是数组", "orphans"));
    return;
  }
  cleanup.orphans.forEach((orphan, index) => {
    if (!validateExactObject(orphan, ORPHAN_FIELDS, `cleanup.orphans[${index}]`, errors)) return;
    validateString(orphan.kind, `cleanup.orphans[${index}].kind`, errors);
    validateFiniteNumber(orphan.pid, `cleanup.orphans[${index}].pid`, errors, { integer: true, minimum: 1 });
  });
}

export function validateRegressionSummary(summary) {
  const errors = [];
  if (!validateExactObject(summary, SUMMARY_FIELDS, "summary", errors)) return errors;
  if (summary.schema !== "codexctl-regression-summary/1") {
    errors.push(issue("invalid-schema", `不支持的结果 schema：${String(summary.schema)}`, "schema"));
  }
  if (typeof summary.runId !== "string" || !UUID_PATTERN.test(summary.runId)) {
    errors.push(issue("invalid-run-id", `runId 非法：${String(summary.runId)}`, "runId"));
  }
  if (typeof summary.revision !== "string" || !REVISION_PATTERN.test(summary.revision)) {
    errors.push(issue("invalid-revision", "revision 必须是 40 位 Git SHA", "revision"));
  }
  if (typeof summary.dirty !== "boolean") errors.push(issue("invalid-dirty", "dirty 必须是布尔值", "dirty"));
  if (!SUMMARY_STATUSES.has(summary.status)) {
    errors.push(issue("invalid-summary-status", `非法总体状态：${String(summary.status)}`, "status"));
  }
  for (const field of ["startedAt", "completedAt"]) {
    if (typeof summary[field] !== "string" || !Number.isFinite(Date.parse(summary[field]))) {
      errors.push(issue("invalid-time", `${field} 必须是 ISO 日期`, field));
    }
  }
  validateEnvironment(summary.environment, errors);
  validateOwnership(summary.ownership, errors);
  validateCounts(summary.counts, errors);
  if (!Array.isArray(summary.cases)) errors.push(issue("invalid-type", "cases 必须是数组", "cases"));
  else summary.cases.forEach((entry, index) => validateCase(entry, index, errors));
  validateCleanup(summary.cleanup, errors);
  return errors;
}

export function assertRegressionSummary(summary) {
  const errors = validateRegressionSummary(summary);
  if (errors.length === 0) return summary;
  const error = new Error(`回归结果未通过 schema：\n${errors.map(({ message }) => `- ${message}`).join("\n")}`);
  error.code = "INVALID_REGRESSION_SUMMARY";
  error.issues = errors;
  throw error;
}

export { isSafeRelative };
