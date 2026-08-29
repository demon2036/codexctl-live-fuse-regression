import path from "node:path";
import { assertRegressionSummary, isSafeRelative } from "./result-schema.mjs";
import { writeTextAtomic } from "../src/util.mjs";

const SCREENSHOT_FIELDS = new Set(["caseId", "file"]);
const SAMPLE_FIELDS = new Set(["caseId", "durationMs", "name", "value"]);

function assertExactFields(value, allowed, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 未知字段：${key}`);
  }
}

function assertSafeScreenshots(screenshots) {
  if (!Array.isArray(screenshots)) throw new Error("screenshots 必须是数组");
  screenshots.forEach((entry, index) => {
    assertExactFields(entry, SCREENSHOT_FIELDS, `screenshots[${index}]`);
    if (typeof entry.caseId !== "string" || entry.caseId.length === 0) {
      throw new Error(`screenshots[${index}].caseId 必须是非空字符串`);
    }
    if (!isSafeRelative(entry.file)) {
      throw new Error(`screenshots[${index}].file 必须是安全相对路径`);
    }
  });
}

function assertSafeMetrics(metrics) {
  assertExactFields(metrics, new Set(["samples"]), "metrics");
  if (!Array.isArray(metrics.samples)) throw new Error("metrics.samples 必须是数组");
  metrics.samples.forEach((sample, index) => {
    assertExactFields(sample, SAMPLE_FIELDS, `metrics.samples[${index}]`);
    if (typeof sample.caseId !== "string" || sample.caseId.length === 0) {
      throw new Error(`metrics.samples[${index}].caseId 必须是非空字符串`);
    }
    for (const key of Object.keys(sample).filter((field) => field !== "caseId" && field !== "name")) {
      if (!Number.isFinite(sample[key])) throw new Error(`metrics.samples[${index}].${key} 必须是有限数字`);
    }
    if (Object.hasOwn(sample, "name") && !/^[a-z][A-Za-z0-9]{0,79}$/.test(sample.name)) {
      throw new Error(`metrics.samples[${index}].name 必须是稳定指标名`);
    }
  });
}

function renderMarkdown(summary) {
  const rows = summary.cases.map((entry) => (
    `| ${entry.id} | ${entry.layer} | ${entry.platform} | ${entry.status} | ${entry.reasonCode ?? "—"} |`
  ));
  return [
    "# codexctl 回归结果",
    "",
    `总体状态：${summary.status}`,
    `源码 revision：${summary.revision}${summary.dirty ? "（dirty）" : ""}`,
    `运行 ID：${summary.runId}`,
    `时间：${summary.startedAt} → ${summary.completedAt}`,
    `清理状态：${summary.cleanup.status}（残留 ${summary.cleanup.orphans.length}）`,
    "",
    "| Case | 层级 | 平台 | 状态 | 原因码 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function resultIsCurrent(summary, { dirty, revision }) {
  return Boolean(
    summary
    && summary.dirty === false
    && dirty === false
    && typeof revision === "string"
    && summary.revision === revision,
  );
}

export async function writeRegressionResults({ directory, metrics, screenshots, summary }) {
  assertRegressionSummary(summary);
  assertSafeMetrics(metrics);
  assertSafeScreenshots(screenshots);
  const documents = [
    ["metrics.json", `${JSON.stringify(metrics, null, 2)}\n`],
    ["screenshots.json", `${JSON.stringify(screenshots, null, 2)}\n`],
    ["summary.json", `${JSON.stringify(summary, null, 2)}\n`],
    ["summary.md", renderMarkdown(summary)],
  ];
  await Promise.all(documents.map(([name, contents]) => (
    writeTextAtomic(path.join(directory, name), contents)
  )));
}
