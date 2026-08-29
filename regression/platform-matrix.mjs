const PLATFORMS = Object.freeze(["macos", "linux"]);

export function evaluatePlatformMatrix({ results = {}, revision, supported = PLATFORMS } = {}) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("platform matrix requires a full source revision");
  }
  const platforms = {};
  for (const platform of supported) {
    if (!PLATFORMS.includes(platform)) throw new Error(`unsupported platform: ${platform}`);
    const result = results[platform];
    const reasons = [];
    if (!result?.actual) reasons.push("actual-result-missing");
    if (result?.dirty !== false) reasons.push("dirty-result");
    if (result?.revision !== revision) reasons.push("revision-mismatch");
    if (result?.status !== "pass") reasons.push(`result-${result?.status ?? "missing"}`);
    platforms[platform] = {
      actual: result?.actual === true,
      dirty: result?.dirty ?? null,
      reasonCodes: [...new Set(reasons)],
      revision: result?.revision ?? null,
      status: reasons.length ? "unverified" : "pass",
    };
  }
  const allPlatformsPass = supported.every((platform) => platforms[platform].status === "pass");
  return {
    schema: "codexctl-platform-matrix/1",
    allPlatformsPass,
    platforms,
    revision,
    status: allPlatformsPass ? "pass" : "unverified",
  };
}
