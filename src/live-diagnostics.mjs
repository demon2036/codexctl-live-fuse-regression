const REVISION = /^[a-f0-9]{24}$/;

export const LIVE_RESOURCE_KEYS = Object.freeze([
  "blobs",
  "dom",
  "listeners",
  "observers",
  "requestPatches",
  "rootAttributes",
  "styles",
  "timers",
  "transfers",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertResources(value) {
  if (!exactKeys(value, LIVE_RESOURCE_KEYS)) {
    throw new Error("live diagnostics resource ledger is invalid");
  }
  for (const key of LIVE_RESOURCE_KEYS) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new Error(`live diagnostics resource ${key} is invalid`);
    }
  }
  return value;
}

export function emptyLiveResources() {
  return Object.fromEntries(LIVE_RESOURCE_KEYS.map((key) => [key, 0]));
}

export function validateLiveDiagnostics(value) {
  if (!exactKeys(value, ["handleCount", "mounted", "resources", "revision"])) {
    throw new Error("live diagnostics shape is invalid");
  }
  if (typeof value.mounted !== "boolean") {
    throw new Error("live diagnostics mounted flag is invalid");
  }
  if (!Number.isSafeInteger(value.handleCount) || value.handleCount < 0) {
    throw new Error("live diagnostics handle count is invalid");
  }
  if (!(value.revision === null || REVISION.test(value.revision))) {
    throw new Error("live diagnostics revision is invalid");
  }
  assertResources(value.resources);
  return value;
}

export function assertLiveUnmounted(value) {
  const diagnostics = validateLiveDiagnostics(value);
  const residuals = LIVE_RESOURCE_KEYS.filter((key) => diagnostics.resources[key] !== 0);
  if (diagnostics.mounted || diagnostics.handleCount !== 0
    || diagnostics.revision !== null || residuals.length > 0) {
    throw new Error(`live slot did not unmount cleanly: ${residuals.join(",") || "identity"}`);
  }
  return diagnostics;
}

export function assertLiveMounted(value, revision) {
  if (!REVISION.test(String(revision ?? ""))) {
    throw new Error("expected live revision is invalid");
  }
  const diagnostics = validateLiveDiagnostics(value);
  if (!diagnostics.mounted || diagnostics.handleCount !== 1
    || diagnostics.revision !== revision) {
    throw new Error(`live slot did not mount exact revision ${revision}`);
  }
  return diagnostics;
}

export function liveRevision(value, label = "revision") {
  const revision = String(value ?? "");
  if (!REVISION.test(revision)) throw new Error(`${label} must be a 24 character revision`);
  return revision;
}
