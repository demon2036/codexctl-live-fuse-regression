import { defineCase } from "./define.mjs";

const C = "app-experience-regression";
const rows = [
  ["PERFORMANCE-STARTUP-001", "交互性能必须接近官方基线", "注入不显著延迟可交互", ["L4", "L5"], ["macos", "linux"], "startup"],
  ["PERFORMANCE-INPUT-002", "交互性能必须接近官方基线", "打字延迟保持丝滑", ["L3", "L4", "L5"], ["macos", "linux"], "input"],
  ["PERFORMANCE-SCROLL-003", "交互性能必须接近官方基线", "Sessions 滚动延迟保持丝滑", ["L3", "L4", "L5"], ["macos", "linux"], "scroll"],
  ["PERFORMANCE-CPU-004", "交互性能必须接近官方基线", "稳态 CPU 与任务数量无回归", ["L3", "L4", "L5"], ["macos", "linux"], "cpu"],
  ["PERFORMANCE-INVALID-BASELINE-005", "交互性能必须接近官方基线", "基线噪声使结果无效", ["L1", "L4"], ["all"], "baseline-validity"],
  ["RECOVERY-CLEAN-RESTART-001", "恢复必须跨完整进程边界", "Clean 后恢复官方状态", ["L2", "L4", "L5"], ["macos", "linux"]],
  ["RECOVERY-HOT-CLEAN-NOT-SUFFICIENT-002", "恢复必须跨完整进程边界", "热撤销后仍卡不被误判修复", ["L1", "L4"], ["all"]],
  ["RECOVERY-OWNED-CLEANUP-003", "恢复必须跨完整进程边界", "清理只作用于精确归属资源", ["L2", "L4"], ["all"]],
  ["PLATFORM-MACOS-IDENTITY-001", "macOS 与 Linux 平台契约分别验收", "macOS 使用官方进程身份", ["L2", "L5"], ["macos"]],
  ["PLATFORM-LINUX-LOOPBACK-002", "macOS 与 Linux 平台契约分别验收", "Linux 使用受限一次性连接", ["L2", "L5"], ["linux"]],
  ["PLATFORM-MISSING-UNVERIFIED-003", "macOS 与 Linux 平台契约分别验收", "缺少平台执行环境", ["L1"], ["all"]],
  ["PLATFORM-LINUX-WORKSPACE-ROUTE-004", "macOS 与 Linux 平台契约分别验收", "Linux 实际包进入隔离工作区", ["L1", "L5"], ["linux"]],
  ["PLATFORM-LINUX-RENDERER-SURFACE-005", "macOS 与 Linux 平台契约分别验收", "Linux 实际包进入隔离工作区", ["L1", "L5"], ["linux"]],
  ["PLATFORM-MACOS-INTERACTIVE-ACTIVATION-006", "macOS 与 Linux 平台契约分别验收", "macOS 使用官方进程身份", ["L1", "L5"], ["macos"]],
];

export const appPerformancePlatformCases = Object.freeze(rows.map((row) => defineCase(C, row)));
