const REQUIRED_LAYERS = Object.freeze(["L1", "L2", "L3", "L4", "L5"]);

export function evaluateDeliveryGate({
  automatedStatus,
  cleanupStatus,
  layers = {},
  revisionCurrent,
  userConfirmed = false,
} = {}) {
  const reasonCodes = [];
  if (automatedStatus !== "pass") reasonCodes.push("automated-gates-not-pass");
  for (const layer of REQUIRED_LAYERS) {
    if (layers[layer] !== "pass") reasonCodes.push(`${layer.toLowerCase()}-not-pass`);
  }
  if (cleanupStatus !== "pass") reasonCodes.push("cleanup-not-pass");
  if (revisionCurrent !== true) reasonCodes.push("revision-not-current");
  const readyForUserAcceptance = reasonCodes.length === 0;
  return {
    accepted: readyForUserAcceptance && userConfirmed === true,
    readyForUserAcceptance,
    reasonCodes,
    status: readyForUserAcceptance ? "pass" : "unverified",
  };
}
