function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderCatalogSummary(cases) {
  const scenarios = cases.filter(({ kind }) => kind === "scenario").length;
  const supplemental = cases.length - scenarios;
  const lines = [
    "# 回归 Case Catalog",
    "",
    "> 此文件由 `npm run catalog` 从 `regression/catalog/` 生成；请勿手工维护条目。",
    "",
    `共 ${cases.length} 个必选 case：${scenarios} 个 OpenSpec Scenario，${supplemental} 个补充门禁。`,
    "",
    "| Case ID | Capability | Scenario | 层级 | 平台 | 预算 | 执行入口 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of cases) {
    const commands = [...new Set(entry.executors.map(({ command }) => command))].join("<br>");
    lines.push(`| \`${cell(entry.id)}\` | ${cell(entry.capability)} | ${cell(
      entry.scenario ?? "补充质量门禁",
    )} | ${cell(entry.layers.join(" / "))} | ${cell(entry.platforms.join(" / "))} | ${cell(
      entry.budgetKey ?? "—",
    )} | ${cell(commands)} |`);
  }
  lines.push(
    "",
    "行为真相来源：",
    "",
    "- [App 体验回归规格](../openspec/changes/codify-regression-tdd/specs/app-experience-regression/spec.md)",
    "- [TDD 质量门禁规格](../openspec/changes/codify-regression-tdd/specs/tdd-quality-gate/spec.md)",
    "- [测试执行说明](TESTING.md)",
    "",
  );
  return lines.join("\n");
}
