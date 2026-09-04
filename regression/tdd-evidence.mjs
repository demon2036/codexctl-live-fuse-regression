const REVISION = /^[0-9a-f]{40}$/;
const CASE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/;

function issue(code, message) {
  return Object.freeze({ code, message });
}

function validRun(run) {
  return run && typeof run.command === "string" && run.command.trim().length > 0
    && REVISION.test(run.revision ?? "") && new Set(["pass", "fail"]).has(run.status);
}

export function validateTddEvidence(record, finalRevision) {
  const errors = [];
  if (!record || typeof record !== "object") return [issue("invalid-record", "evidence 必须是对象")];
  if (!CASE_ID.test(record.caseId ?? "")) errors.push(issue("invalid-case", "case ID 非法"));
  if (!new Set(["defect", "characterization"]).has(record.kind)) {
    errors.push(issue("invalid-kind", "evidence kind 必须是 defect 或 characterization"));
  }
  if (!REVISION.test(record.parentRevision ?? "")) {
    errors.push(issue("missing-parent-revision", "缺少有效 parent revision"));
  }
  if (!REVISION.test(finalRevision ?? "")) errors.push(issue("invalid-final-revision", "最终 revision 非法"));
  if (!validRun(record.red)) errors.push(issue("invalid-red-run", "Red/characterization 运行记录不完整"));
  if (!validRun(record.green)) errors.push(issue("invalid-green-run", "Green 运行记录不完整"));
  if (record.green?.revision !== finalRevision) {
    errors.push(issue("green-revision-mismatch", "Green revision 与最终 revision 不匹配"));
  }
  if (record.kind === "defect") {
    if (record.red?.status !== "fail") errors.push(issue("red-did-not-fail", "缺陷 Red 必须失败"));
    if (record.red?.failureKind !== "behavior") {
      errors.push(issue("wrong-red-reason", "Red 必须因目标行为偏差失败"));
    }
    if (typeof record.red?.expectedFailure !== "string"
      || typeof record.red?.observedFailure !== "string"
      || !record.red.observedFailure.includes(record.red.expectedFailure)) {
      errors.push(issue("wrong-red-assertion", "Red 失败原因未命中预期断言"));
    }
    if (record.green?.status !== "pass") errors.push(issue("green-did-not-pass", "Green 必须通过"));
  }
  if (record.kind === "characterization") {
    if (record.red?.status !== "pass" || record.red?.failureKind != null) {
      errors.push(issue("forged-refactor-red", "纯重构必须使用通过的 characterization，不能伪造 Red"));
    }
    if (record.behaviorChanged === true) {
      errors.push(issue("characterization-behavior-change", "行为变化必须转换为 defect Red/Green"));
    }
    if (record.green?.status !== "pass") {
      errors.push(issue("characterization-regressed", "重构后 characterization 必须继续通过"));
    }
  }
  return errors;
}

export function assertTddEvidence(record, finalRevision) {
  const errors = validateTddEvidence(record, finalRevision);
  if (errors.length) {
    const error = new Error(errors.map(({ message }) => message).join("\n"));
    error.code = "INVALID_TDD_EVIDENCE";
    error.issues = errors;
    throw error;
  }
  return record;
}
