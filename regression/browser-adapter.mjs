import { regressionCases } from "./catalog/index.mjs";

const L3_CASES = new Map(regressionCases
  .filter((entry) => entry.layers.includes("L3"))
  .map((entry) => [entry.id, entry]));
const STATUSES = new Set(["pass", "fail", "unverified", "blocked", "invalid"]);

export function browserReportToCaseResults(report, {
  evidence = "artifacts/browser.json",
  durationMs = 0,
} = {}) {
  if (report?.schema !== "codexctl-browser-regression/1" || !Array.isArray(report.cases)) {
    throw new Error("浏览器报告 schema 无效");
  }
  if (report.cleanup?.profileRemoved !== true || report.cleanup?.processExited !== true) {
    throw new Error("浏览器报告 cleanup 未通过");
  }
  const seen = new Set();
  return report.cases.map((row) => {
    const catalog = L3_CASES.get(row?.id);
    if (!catalog) throw new Error(`浏览器报告包含未知 L3 case：${String(row?.id)}`);
    if (seen.has(row.id)) throw new Error(`浏览器报告包含重复 case：${row.id}`);
    seen.add(row.id);
    if (!STATUSES.has(row.status)) throw new Error(`浏览器 case 状态无效：${row.status}`);
    const stress = report.metrics?.wallpaperStress ?? {};
    return {
      durationMs,
      evidence: [evidence],
      id: row.id,
      layer: "L3",
      metrics: {
        layoutReads: Number(stress.layoutReads ?? 0),
        mutationCount: Number(stress.mutationRecords ?? 0),
        observerCount: Number(stress.observers ?? 0),
        reconcileCount: Number(stress.reconciles ?? 0),
        timerCount: Number(stress.timers ?? 0),
      },
      platform: catalog.platforms.length === 1 ? catalog.platforms[0] : "all",
      reasonCode: row.status === "pass" ? null : row.reasonCode ?? "browser-assertion-failed",
      status: row.status,
    };
  });
}
