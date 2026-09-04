const STATUSES = ["pass", "invalid", "unverified", "blocked", "fail"];
const EXIT_CODES = Object.freeze({ pass: 0, fail: 1, unverified: 2, blocked: 3, invalid: 4 });

function normalizedStatus(result) {
  if (!STATUSES.includes(result?.status)) return "fail";
  if (
    result.status === "invalid"
    && Number.isSafeInteger(result.attempts)
    && Number.isSafeInteger(result.maxAttempts)
    && result.attempts < result.maxAttempts
  ) return "blocked";
  return result.status;
}

function highestStatus(results) {
  return results.reduce((highest, result) => {
    const status = normalizedStatus(result);
    return STATUSES.indexOf(status) > STATUSES.indexOf(highest) ? status : highest;
  }, "pass");
}

export function aggregateRun({ caseResults = [], cleanup = { status: "fail" } } = {}) {
  const counts = { blocked: 0, fail: 0, invalid: 0, pass: 0, unverified: 0 };
  for (const result of caseResults) {
    const status = STATUSES.includes(result?.status) ? result.status : "fail";
    counts[status] += 1;
  }
  const status = cleanup?.status === "pass" ? highestStatus(caseResults) : "fail";
  return { counts, exitCode: EXIT_CODES[status], status };
}

function failedResult(id, reasonCode) {
  return { id, reasonCode, status: "fail" };
}

async function runCase(entry, executors) {
  const layerResults = [];
  for (const layer of entry.layers ?? []) {
    const executor = executors[layer];
    if (typeof executor !== "function") {
      layerResults.push(failedResult(entry.id, "missing-executor"));
      continue;
    }
    try {
      const result = await executor(entry, layer);
      layerResults.push({ ...result, id: entry.id });
    } catch {
      layerResults.push(failedResult(entry.id, "executor-threw"));
    }
  }
  if (layerResults.length === 0) return failedResult(entry.id, "missing-executor");
  const status = highestStatus(layerResults);
  const selected = layerResults.findLast((result) => normalizedStatus(result) === status);
  return { ...selected, id: entry.id, status };
}

export async function runSelectedCases({
  cases = [],
  cleanup = async () => ({ status: "fail" }),
  executors = {},
  selectedIds = null,
} = {}) {
  const selected = selectedIds === null
    ? cases
    : cases.filter(({ id }) => selectedIds.has(id));
  const caseResults = [];
  let cleanupResult;
  try {
    for (const entry of selected) caseResults.push(await runCase(entry, executors));
  } finally {
    try {
      cleanupResult = await cleanup();
    } catch {
      cleanupResult = { status: "fail" };
    }
  }
  return {
    ...aggregateRun({ caseResults, cleanup: cleanupResult }),
    caseResults,
    cleanup: cleanupResult,
  };
}
