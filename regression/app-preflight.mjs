import path from "node:path";

function inside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function unsafeProfile(profile) {
  if (!path.isAbsolute(profile?.path ?? "") || !path.isAbsolute(profile?.runRoot ?? "")) return true;
  const target = path.resolve(profile.path);
  if (!inside(target, profile.runRoot)) return true;
  return (profile.productionPaths ?? []).some((entry) => path.resolve(entry) === target);
}

export function evaluateAppPreflight(input = {}) {
  const fail = [];
  const unverified = [];
  const app = input.app ?? {};
  if (![app.bundle, app.executable, app.cliPath].every((value) => path.isAbsolute(value ?? ""))) {
    fail.push("invalid-app-path");
  }
  if (!inside(app.executable ?? ".", app.bundle ?? ".")) fail.push("executable-not-embedded");
  if (!inside(app.cliPath ?? ".", app.bundle ?? ".")
    || !String(app.cliPath ?? "").includes(`${path.sep}Contents${path.sep}Resources${path.sep}`)) {
    fail.push("cli-not-embedded");
  }
  if (![app.appVersion, app.cliVersion].every((value) => (
    typeof value === "string" && value.trim().length > 0 && value.length <= 120
  ))) fail.push("missing-version");
  if (!Number.isInteger(input.viewport?.width) || !Number.isInteger(input.viewport?.height)
    || input.viewport.width < 800 || input.viewport.height < 600) {
    fail.push("viewport-too-small");
  }
  if (unsafeProfile(input.profile)) fail.push("unsafe-profile");

  const targetPid = input.process?.targetPid;
  const owned = new Set(input.process?.ownedPids ?? []);
  const protectedPids = new Set(input.process?.protectedPrimaryPids ?? []);
  if (targetPid != null || input.operation === "probe") {
    if (protectedPids.has(targetPid)) fail.push("protected-primary");
    else if (!Number.isSafeInteger(targetPid) || !owned.has(targetPid)) fail.push("unknown-pid");
  }
  if (input.permissions?.accessibility !== true) unverified.push("permission-accessibility");
  if (input.permissions?.screenRecording !== true) unverified.push("permission-screen-recording");

  const reasonCodes = [...new Set(fail.length > 0 ? fail : unverified)];
  return {
    reasonCodes,
    status: fail.length > 0 ? "fail" : unverified.length > 0 ? "unverified" : "pass",
  };
}

export async function runPreflightedApp({ input, launch }) {
  if (typeof launch !== "function") throw new TypeError("launch 必须是函数");
  const preflight = evaluateAppPreflight(input);
  if (preflight.status !== "pass") return preflight;
  return { ...preflight, value: await launch() };
}
