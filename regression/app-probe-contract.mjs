const RESULT_FIELDS = [
  "schema", "platform", "mode", "status", "reasonCodes", "identity", "remote",
  "processTree", "visual", "controls", "metrics", "diagnostics", "cleanup",
];
const IDENTITY_FIELDS = [
  "appVersion", "cliVersion", "executableId", "pid", "profileId", "startedAt",
];
const PROCESS_FIELDS = ["appServerCount", "controllerCount", "duplicatePresence", "processCount"];
const VISUAL_FIELDS = ["regions", "sidebarDocked", "sidebarMainGap", "wallpaperVisibleMs"];
const REGION_NAMES = ["wallpaper", "bottom", "sidebar", "main", "composer"];
const REGION_FIELDS = ["background", "bounds", "visible"];
const BOUNDS_FIELDS = ["height", "width", "x", "y"];
const CONTROL_FIELDS = ["context", "prompt"];
const CONTROL_VALUE_FIELDS = ["bounds", "count", "reachable"];
const METRIC_FIELDS = [
  "cpuMedian", "cpuP95", "inputMaxMs", "inputP95Ms", "layoutReads", "longTaskCount",
  "observerCount", "scrollMaxMs", "scrollP95Ms", "timerCount", "workerCount",
];
const DIAGNOSTIC_FIELDS = ["contextRevision", "promptRevision", "wallpaperRevision"];
const CLEANUP_FIELDS = ["orphans", "status"];
const ORPHAN_FIELDS = ["kind", "pid"];
const REQUIRED_METHODS = [
  "preflight", "launch", "remote", "processTree", "visual", "controls", "metrics",
  "diagnostics", "cleanup",
];
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REVISION_PATTERN = /^[0-9a-f]{24}$/;
const MODULE_NAMES = Object.freeze(["context", "prompt", "wallpaper"]);
const ALL_MODULES = Object.freeze({ context: true, prompt: true, wallpaper: true });

function issue(code, field, message) {
  return Object.freeze({ code, field, message });
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectedModules(value = ALL_MODULES) {
  const keys = record(value) ? Object.keys(value).sort() : [];
  if (keys.length !== MODULE_NAMES.length
    || keys.some((key, index) => key !== MODULE_NAMES[index])
    || MODULE_NAMES.some((name) => typeof value[name] !== "boolean")) {
    throw new TypeError("expectedModules 必须包含 context、prompt、wallpaper 三个布尔值");
  }
  return value;
}

function exact(value, fields, label, errors) {
  if (!record(value)) {
    errors.push(issue("invalid-type", label, `${label} 必须是对象`));
    return false;
  }
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      errors.push(issue("missing-field", `${label}.${field}`, `${label} 缺少字段：${field}`));
    }
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      errors.push(issue("unknown-field", `${label}.${field}`, `${label} 未知字段：${field}`));
    }
  }
  return true;
}

function finite(value, field, errors, { integer = false, minimum = 0 } = {}) {
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) {
    errors.push(issue("invalid-number", field, `${field} 必须是${integer ? "安全整数" : "有限非负数"}`));
  }
}

function boolean(value, field, errors) {
  if (typeof value !== "boolean") errors.push(issue("invalid-boolean", field, `${field} 必须是布尔值`));
}

function safeId(value, field, errors) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    errors.push(issue("invalid-id", field, `${field} 必须是无路径的安全标识`));
  }
}

function validateBounds(value, label, errors) {
  if (!exact(value, BOUNDS_FIELDS, label, errors)) return;
  finite(value.height, `${label}.height`, errors);
  finite(value.width, `${label}.width`, errors);
  finite(value.x, `${label}.x`, errors, { minimum: Number.NEGATIVE_INFINITY });
  finite(value.y, `${label}.y`, errors, { minimum: Number.NEGATIVE_INFINITY });
}

function validateIdentity(value, errors) {
  if (!exact(value, IDENTITY_FIELDS, "identity", errors)) return;
  for (const field of ["appVersion", "cliVersion", "startedAt"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      errors.push(issue("invalid-string", `identity.${field}`, `identity.${field} 必须是非空字符串`));
    }
  }
  safeId(value.executableId, "identity.executableId", errors);
  safeId(value.profileId, "identity.profileId", errors);
  finite(value.pid, "identity.pid", errors, { integer: true, minimum: 1 });
}

function validateRemote(value, errors) {
  if (!exact(value, ["errors", "status"], "remote", errors)) return;
  if (!new Set(["connected", "disconnected", "unverified"]).has(value.status)) {
    errors.push(issue("invalid-status", "remote.status", `remote.status 非法：${String(value.status)}`));
  }
  if (!Array.isArray(value.errors)) {
    errors.push(issue("invalid-type", "remote.errors", "remote.errors 必须是原因码数组"));
  } else for (const code of value.errors) {
    if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
      errors.push(issue("invalid-reason", "remote.errors", `Remote 原因码非法：${String(code)}`));
    }
  }
}

function validateProcessTree(value, errors) {
  if (!exact(value, PROCESS_FIELDS, "processTree", errors)) return;
  for (const field of ["appServerCount", "controllerCount", "processCount"]) {
    finite(value[field], `processTree.${field}`, errors, { integer: true });
  }
  boolean(value.duplicatePresence, "processTree.duplicatePresence", errors);
}

function validateVisual(value, errors) {
  if (!exact(value, VISUAL_FIELDS, "visual", errors)) return;
  if (exact(value.regions, REGION_NAMES, "visual.regions", errors)) {
    for (const name of REGION_NAMES) {
      const region = value.regions[name];
      const label = `visual.regions.${name}`;
      if (!exact(region, REGION_FIELDS, label, errors)) continue;
      if (!new Set(["transparent", "theme", "opaque-black", "other"]).has(region.background)) {
        errors.push(issue("invalid-background", `${label}.background`, `${label}.background 非法`));
      }
      validateBounds(region.bounds, `${label}.bounds`, errors);
      boolean(region.visible, `${label}.visible`, errors);
    }
  }
  boolean(value.sidebarDocked, "visual.sidebarDocked", errors);
  finite(value.sidebarMainGap, "visual.sidebarMainGap", errors, { minimum: Number.NEGATIVE_INFINITY });
  finite(value.wallpaperVisibleMs, "visual.wallpaperVisibleMs", errors);
}

function validateControls(value, errors) {
  if (!exact(value, CONTROL_FIELDS, "controls", errors)) return;
  for (const name of CONTROL_FIELDS) {
    const control = value[name];
    const label = `controls.${name}`;
    if (!exact(control, CONTROL_VALUE_FIELDS, label, errors)) continue;
    validateBounds(control.bounds, `${label}.bounds`, errors);
    finite(control.count, `${label}.count`, errors, { integer: true });
    boolean(control.reachable, `${label}.reachable`, errors);
  }
}

function validateMetrics(value, errors) {
  if (!exact(value, METRIC_FIELDS, "metrics", errors)) return;
  for (const field of METRIC_FIELDS) finite(value[field], `metrics.${field}`, errors);
}

function validateDiagnostics(value, errors) {
  if (!exact(value, DIAGNOSTIC_FIELDS, "diagnostics", errors)) return;
  for (const field of DIAGNOSTIC_FIELDS) {
    if (!(value[field] === null || (typeof value[field] === "string" && REVISION_PATTERN.test(value[field])))) {
      errors.push(issue("invalid-revision", `diagnostics.${field}`, `${field} 必须是 24 位 revision 或 null`));
    }
  }
}

function validateCleanup(value, errors) {
  if (!exact(value, CLEANUP_FIELDS, "cleanup", errors)) return;
  if (!new Set(["pass", "fail"]).has(value.status)) {
    errors.push(issue("invalid-status", "cleanup.status", `cleanup.status 非法：${String(value.status)}`));
  }
  if (!Array.isArray(value.orphans)) {
    errors.push(issue("invalid-type", "cleanup.orphans", "cleanup.orphans 必须是数组"));
    return;
  }
  value.orphans.forEach((orphan, index) => {
    const label = `cleanup.orphans[${index}]`;
    if (!exact(orphan, ORPHAN_FIELDS, label, errors)) return;
    safeId(orphan.kind, `${label}.kind`, errors);
    finite(orphan.pid, `${label}.pid`, errors, { integer: true, minimum: 1 });
  });
}

export function validateAppProbeResult(result) {
  const errors = [];
  if (!exact(result, RESULT_FIELDS, "result", errors)) return errors;
  if (result.schema !== "codexctl-app-probe/1") {
    errors.push(issue("invalid-schema", "schema", `不支持的 App probe schema：${String(result.schema)}`));
  }
  if (!new Set(["macos", "linux"]).has(result.platform)) {
    errors.push(issue("invalid-platform", "platform", `platform 非法：${String(result.platform)}`));
  }
  if (!new Set(["official", "injected"]).has(result.mode)) {
    errors.push(issue("invalid-mode", "mode", `mode 非法：${String(result.mode)}`));
  }
  if (!new Set(["pass", "fail", "unverified"]).has(result.status)) {
    errors.push(issue("invalid-status", "status", `status 非法：${String(result.status)}`));
  }
  if (!Array.isArray(result.reasonCodes)) {
    errors.push(issue("invalid-type", "reasonCodes", "reasonCodes 必须是数组"));
  } else for (const code of result.reasonCodes) {
    if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
      errors.push(issue("invalid-reason", "reasonCodes", `原因码非法：${String(code)}`));
    }
  }
  validateIdentity(result.identity, errors);
  validateRemote(result.remote, errors);
  validateProcessTree(result.processTree, errors);
  validateVisual(result.visual, errors);
  validateControls(result.controls, errors);
  validateMetrics(result.metrics, errors);
  validateDiagnostics(result.diagnostics, errors);
  validateCleanup(result.cleanup, errors);
  return errors;
}

function semanticResult(parts, mode, modules) {
  const reasons = new Set(parts.preflight.reasonCodes ?? []);
  let status = parts.preflight.status === "unverified" ? "unverified" : "pass";
  const fail = (condition, code) => { if (condition) { reasons.add(code); status = "fail"; } };
  if (parts.remote.status === "unverified" && status === "pass") status = "unverified";
  fail(parts.remote.status === "disconnected", "remote-disconnected");
  fail(parts.processTree.appServerCount !== 1, "app-server-count");
  fail(parts.processTree.controllerCount !== 0, "controller-still-running");
  fail(parts.processTree.duplicatePresence, "duplicate-presence");
  if (mode === "injected" && modules.wallpaper) {
    fail(parts.visual.wallpaperVisibleMs > 750, "wallpaper-visible-late");
    fail(parts.visual.regions.bottom.background === "opaque-black", "bottom-opaque-black");
    fail(!parts.visual.sidebarDocked || parts.visual.sidebarMainGap < 0, "sidebar-overlaps-main");
  }
  for (const [name, region] of Object.entries(parts.visual.regions)) {
    fail(region.visible !== true, `${name}-not-visible`);
  }
  if (mode === "injected") for (const [name, control] of Object.entries(parts.controls)) {
    const enabled = modules[name];
    fail(control.count !== Number(enabled), `${name}-control-count`);
    fail(control.reachable !== enabled, `${name}-control-unreachable`);
  }
  for (const field of ["layoutReads", "longTaskCount", "observerCount", "timerCount", "workerCount"]) {
    fail(parts.metrics[field] !== 0, `steady-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  fail(parts.cleanup.status !== "pass" || parts.cleanup.orphans.length !== 0, "cleanup-failed");
  return { reasonCodes: [...reasons].sort(), status };
}

export async function runAppProbe({ adapter, mode, request } = {}) {
  if (!record(adapter)) throw new TypeError("App probe adapter 必须是对象");
  const modules = expectedModules(request?.expectedModules);
  const parts = {};
  let primaryError;
  try {
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== "function") throw new TypeError(`adapter 缺少 ${method} method`);
    }
    parts.preflight = await adapter.preflight(request);
    if (!record(parts.preflight) || !new Set(["pass", "unverified"]).has(parts.preflight.status)) {
      throw new Error("adapter preflight 未通过或返回非法结果");
    }
    parts.identity = await adapter.launch(request);
    for (const method of ["remote", "processTree", "visual", "controls", "metrics", "diagnostics"]) {
      parts[method] = await adapter[method](request, parts.identity);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (typeof adapter.cleanup === "function") {
      try { parts.cleanup = await adapter.cleanup(request, parts.identity); }
      catch (error) { if (!primaryError) primaryError = error; else primaryError.cleanupError = error; }
    }
  }
  if (primaryError) throw primaryError;
  const semantics = semanticResult(parts, mode, modules);
  const result = {
    schema: "codexctl-app-probe/1", platform: adapter.platform, mode,
    ...semantics, identity: parts.identity, remote: parts.remote,
    processTree: parts.processTree, visual: parts.visual, controls: parts.controls,
    metrics: parts.metrics, diagnostics: parts.diagnostics, cleanup: parts.cleanup,
  };
  const errors = validateAppProbeResult(result);
  if (errors.length > 0) {
    const error = new Error(`App probe 结果非法：\n${errors.map(({ message }) => `- ${message}`).join("\n")}`);
    error.code = "INVALID_APP_PROBE_RESULT";
    error.issues = errors;
    throw error;
  }
  return result;
}
