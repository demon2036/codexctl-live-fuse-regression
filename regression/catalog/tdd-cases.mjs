import { defineCase } from "./define.mjs";

const C = "tdd-quality-gate";
const rows = [
  ["TDD-RED-EVIDENCE-001", "每个行为修复先产生有效 Red", "缺陷修复的 Red 证据有效", ["L1"], ["all"]],
  ["TDD-UNAUTOMATABLE-BOUNDARY-002", "每个行为修复先产生有效 Red", "无法自动化的缺陷先定义可执行边界", ["L1"], ["all"]],
  ["TDD-CHARACTERIZATION-003", "每个行为修复先产生有效 Red", "纯重构使用 Characterization 测试", ["L1"], ["all"]],
  ["TDD-GREEN-MINIMAL-004", "Green 只做满足契约的最小实现", "最小实现通过相关测试", ["L1"], ["all"]],
  ["TDD-BUDGET-INDEPENDENT-005", "Green 只做满足契约的最小实现", "修改预算或期望值需要独立决策", ["L1"], ["all"]],
  ["TDD-REAL-BOUNDARY-006", "Green 只做满足契约的最小实现", "Mock 不能替代真实边界", ["L1", "L4"], ["all"]],
  ["TDD-FILE-LIMIT-007", "Refactor 在全绿状态下保持行为不变", "文件接近上限时按职责拆分", ["L1"], ["all"]],
  ["TDD-ZERO-STEADY-STATE-008", "Refactor 在全绿状态下保持行为不变", "性能敏感重构保持零稳态合同", ["L1", "L3"], ["all"]],
  ["TDD-FAST-GATE-009", "回归门禁采用五层证据", "日常修改执行快速层", ["L1", "L2", "L3"], ["all"]],
  ["TDD-APP-AB-GATE-010", "回归门禁采用五层证据", "App 边界修改执行隔离 A/B", ["L4"], ["all"]],
  ["TDD-PLATFORM-GATE-011", "回归门禁采用五层证据", "发布候选执行目标平台验收", ["L5"], ["macos", "linux"]],
  ["TDD-CATALOG-NEW-CASE-012", "回归目录可追踪且无静默缺口", "新回归场景加入目录", ["L1"], ["all"]],
  ["TDD-CATALOG-MISSING-TEST-013", "回归目录可追踪且无静默缺口", "测试被删除或改名", ["L1"], ["all"]],
  ["TDD-CROSS-LAYER-MAPPING-014", "回归目录可追踪且无静默缺口", "同一行为跨层覆盖", ["L1"], ["all"]],
  ["TDD-OWNERSHIP-CONCURRENT-015", "测试环境确定、隔离且可安全回收", "并发测试互不污染", ["L1", "L2"], ["all"]],
  ["TDD-PROTECT-MAIN-APP-016", "测试环境确定、隔离且可安全回收", "用户主 App 正在工作", ["L1", "L4"], ["all"]],
  ["TDD-CLEANUP-ON-FAILURE-017", "测试环境确定、隔离且可安全回收", "测试异常退出", ["L1", "L2"], ["all"]],
  ["TDD-BOUNDED-DEADLINE-018", "失败必须确定且禁止用重试掩盖", "条件在超时内未满足", ["L1", "L2"], ["all"]],
  ["TDD-INVALID-SAMPLE-019", "失败必须确定且禁止用重试掩盖", "性能样本被判为无效", ["L1"], ["all"], "baseline-validity"],
  ["TDD-RESULT-SUCCESS-020", "每次运行生成可审计结果", "完整回归成功", ["L1", "L2"], ["all"]],
  ["TDD-RESULT-NONPASS-021", "每次运行生成可审计结果", "任一必选 case 未通过", ["L1", "L2"], ["all"]],
  ["TDD-APP-UNVERIFIED-022", "交付门禁不可由文案替代", "自动测试通过但真实 App 未验证", ["L1"], ["all"]],
  ["TDD-USER-ACCEPTANCE-023", "交付门禁不可由文案替代", "开发者自测完成后请求用户确认", ["L1"], ["all"]],
  ["TDD-REVISION-CONSISTENCY-024", "交付门禁不可由文案替代", "工作区或结果与 revision 不一致", ["L1", "L2"], ["all"]],
  ["TDD-FIXTURE-DRAIN-025", "测试环境确定、隔离且可安全回收", "fixture 进程晚于临时目录退出", ["L1", "L2"], ["all"]],
];

export const tddCases = Object.freeze(rows.map((row) => defineCase(C, row)));
