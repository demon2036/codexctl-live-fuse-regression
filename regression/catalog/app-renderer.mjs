import { defineCase } from "./define.mjs";

const C = "app-experience-regression";
const rows = [
  ["WALLPAPER-FIRST-VISIBLE-001", "Wallpaper 完整视觉与零稳态开销", "首次可交互时壁纸及时可见", ["L1", "L3", "L4"], ["all"], "startup-visible"],
  ["WALLPAPER-BOTTOM-COVERAGE-002", "Wallpaper 完整视觉与零稳态开销", "Bottom panel 不再露出黑底", ["L1", "L3", "L4"], ["all"]],
  ["WALLPAPER-THEME-SEMANTICS-003", "Wallpaper 完整视觉与零稳态开销", "Sidebar 与内容区保持主题语义", ["L1", "L3", "L4"], ["all"]],
  ["WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001", "Wallpaper 完整视觉与零稳态开销", "桌面 Sessions 侧栏展开时推开主内容", ["L1", "L3", "L4"], ["all"]],
  ["WALLPAPER-ZERO-HOTPATH-004", "Wallpaper 完整视觉与零稳态开销", "Wallpaper 稳态不响应输入和滚动", ["L1", "L3", "L4"], ["all"]],
  ["PROMPT-CONTEXT-ANCHOR-001", "Prompt 与 Context 行为和位置一致", "控件随 composer 扩展而定位正确", ["L1", "L3", "L4"], ["all"]],
  ["PROMPT-CONTEXT-SEND-RECOVERY-001", "Prompt 与 Context 行为和位置一致", "发送后原生输入框恢复时控件完整恢复", ["L3"], ["all"]],
  ["PROMPT-DEFAULT-THREAD-002", "Prompt 与 Context 行为和位置一致", "Prompt 默认值和当前 thread 保持明确", ["L1", "L3"], ["all"]],
  ["PROMPT-NEXT-BASE-003", "Prompt 与 Context 行为和位置一致", "Developer Prompt 的 Next Base 只消费一次", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-COPY-SEMANTICS-001", "Prompt 与 Context 行为和位置一致", "Context 文案不继承 Prompt one-shot 语义", ["L1", "L3"], ["all"]],
  ["PROMPT-CONTEXT-NAVIGATION-PERF-004", "Prompt 与 Context 行为和位置一致", "高频导航和输入不增加后台工作", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-NATIVE-NO-OVERRIDE-002", "Context 是当前 thread 的可变实时控制", "Native Context 不覆盖官方字段", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-IDLE-MONOTONIC-003", "Context 是当前 thread 的可变实时控制", "空闲 thread 的合法目标立即生效", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-ACTIVE-SAFE-BOUNDARY-004", "Context 是当前 thread 的可变实时控制", "正在生成时在当前 thread 的安全边界生效", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-QUEUE-COALESCE-005", "Context 是当前 thread 的可变实时控制", "连续选择只应用最后一个合法目标", ["L1", "L3"], ["all"]],
  ["CONTEXT-SHRINK-APPLY-006", "Context 是当前 thread 的可变实时控制", "缩小 Context 并在需要时标记下轮 compact", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-NATIVE-COMPARABLE-007", "Context 是当前 thread 的可变实时控制", "Native 参与相同的容量判定", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-NATIVE-UNKNOWN-008", "Context 是当前 thread 的可变实时控制", "Native 容量无法可靠解析", ["L1", "L3"], ["all"]],
  ["CONTEXT-IDEMPOTENT-009", "Context 是当前 thread 的可变实时控制", "选择当前 Context 是幂等操作", ["L1", "L3"], ["all"]],
  ["CONTEXT-WINDOW-MAPPING-010", "Context 是当前 thread 的可变实时控制", "272K 和 450K 映射准确", ["L1", "L3", "L4"], ["all"]],
  ["CONTEXT-PENDING-FRESH-USAGE-011", "Context 是当前 thread 的可变实时控制", "热切换期间展示区分配置值与有效值", ["L1", "L3", "L4"], ["all"]],
];

export const appRendererCases = Object.freeze(rows.map((row) => defineCase(C, row)));
