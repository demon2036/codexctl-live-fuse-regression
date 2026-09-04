import { randomUUID } from "node:crypto";
import { liveRevision } from "./live-diagnostics.mjs";

export function liveArtifact(value, label = "artifact") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is required`);
  }
  const id = String(value.id ?? "");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error(`${label} id is invalid`);
  return Object.freeze({ ...value, id, revision: liveRevision(value.revision, `${label} revision`) });
}

export function publicLiveArtifact(value) {
  return value ? { id: value.id, revision: value.revision } : null;
}

export function liveTarget(kind, value = null) {
  return value ? Object.freeze({ artifact: value, kind }) : null;
}

export function sameLiveTarget(left, right) {
  return left?.kind === right?.kind
    && left?.artifact?.revision === right?.artifact?.revision;
}

export function liveTransactionRecord(kind, slots, before, after) {
  return {
    id: randomUUID(),
    kind,
    slots: [...slots],
    before,
    after,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    rollback: null,
    status: "running",
  };
}

export function failedLiveRollback(error, failures, cleanupFailures) {
  const status = failures.length
    ? cleanupFailures.length ? "cleanup-failed" : "failed-safe"
    : "rolled-back";
  return {
    code: cleanupFailures.length ? "cleanup-failed"
      : failures.length ? "rollback-failed" : "transaction-failed",
    message: failures.length
      ? `${error}; rollback failed: ${failures.join("; ")}`
        + (cleanupFailures.length ? `; cleanup failed: ${cleanupFailures.join("; ")}` : "")
      : error,
    rollback: failures.length
      ? { cleanupFailures, failures, status }
      : { cleanupFailures: [], failures: [], status: "verified" },
    status,
  };
}

export class LiveStateError extends Error {
  constructor(code, message, transaction = null) {
    super(message);
    this.name = "LiveStateError";
    this.code = code;
    this.transaction = transaction;
  }
}
