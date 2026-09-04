import fs from "node:fs/promises";
import path from "node:path";

const TOKEN = /^[a-z][a-z0-9-]{1,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[0-9a-f]{40}$/;

function requireMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${label}`);
}

export function buildScriptFailureEvidence({
  dirty,
  reasonCode,
  revision,
  runId,
  schema,
  selectedCase = null,
  stage,
} = {}) {
  requireMatch(runId, UUID, "runId");
  requireMatch(revision, REVISION, "revision");
  requireMatch(reasonCode, TOKEN, "reasonCode");
  requireMatch(stage, TOKEN, "stage");
  if (typeof dirty !== "boolean" || typeof schema !== "string"
    || !/^codexctl-[a-z0-9-]+\/\d+$/.test(schema)) throw new Error("Invalid failure evidence");
  if (!(selectedCase === null || /^[A-Z][A-Z0-9-]+-\d{3}$/.test(selectedCase))) {
    throw new Error("Invalid selectedCase");
  }
  return Object.freeze({
    schema, runId, revision, dirty, status: "fail", selectedCase,
    failure: Object.freeze({ reasonCode, stage }),
  });
}

export async function writeScriptFailureEvidence({ directory, ...fields } = {}) {
  if (!path.isAbsolute(directory ?? "")) throw new Error("Failure directory must be absolute");
  const evidence = buildScriptFailureEvidence(fields);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(directory, "summary.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 },
  );
  return evidence;
}
