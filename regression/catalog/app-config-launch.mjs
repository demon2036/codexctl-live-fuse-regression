import { defineCase, defineSupplemental } from "./define.mjs";

const CAPABILITY = "app-experience-regression";
const rows = [
  ["CONFIG-DEFAULTS-001", "配置默认值与用户状态连续性", "全新 codexctl 配置使用正确默认值", ["L1"], ["all"]],
  ["CONFIG-PROXY-SCOPE-002", "配置默认值与用户状态连续性", "项目代理保持局部且无凭据", ["L1", "L2"], ["all"]],
  ["CONFIG-PROVIDER-PRESERVE-003", "配置默认值与用户状态连续性", "未知 provider 不由 codexctl 注入", ["L1", "L2"], ["all"]],
  ["CONFIG-SESSION-IDENTITY-004", "配置默认值与用户状态连续性", "主实例保持历史会话身份", ["L2", "L4"], ["all"]],
  ["LAUNCH-OFFICIAL-ICON-EQUIVALENCE-001", "Official 启动、单实例与 Remote 等价", "Official 启动等价于图标启动", ["L2", "L5"], ["macos", "linux"]],
  ["LAUNCH-REMOTE-INJECTED-002", "Official 启动、单实例与 Remote 等价", "注入启动保持 Remote 可连接", ["L2", "L4", "L5"], ["macos", "linux"]],
  ["LAUNCH-DESCENDANT-DRAIN-003", "Official 启动、单实例与 Remote 等价", "替换旧实例时排空完整后代树", ["L2", "L4"], ["all"]],
  ["LAUNCH-UNKNOWN-INSTANCE-004", "Official 启动、单实例与 Remote 等价", "未知并行实例安全失败", ["L2"], ["all"]],
  ["INJECTION-ONE-SHOT-CONTROLLER-001", "一次性注入是原子完整进程事务", "成功注入后无常驻控制器", ["L2", "L4"], ["all"]],
  ["INJECTION-STATIC-RESTART-002", "一次性注入是原子完整进程事务", "静态注入配置变更延迟到下次完整启动", ["L1", "L2"], ["all"]],
  ["INJECTION-REPEAT-NO-ACCUMULATION-003", "一次性注入是原子完整进程事务", "重复注入不累积状态", ["L2", "L4"], ["all"]],
  ["INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002", "一次性注入是原子完整进程事务", "macOS preload 在启动导航后仍有界完成", ["L1", "L2", "L4", "L5"], ["macos"]],
  ["INJECTION-ROLLBACK-OFFICIAL-004", "一次性注入是原子完整进程事务", "半安装失败回退到干净官方实例", ["L2", "L4"], ["all"]],
];

export const appConfigLaunchCases = Object.freeze([
  ...rows.map((row) => defineCase(CAPABILITY, row)),
  defineSupplemental(CAPABILITY, [
    "INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001",
    "一次性注入是原子完整进程事务",
    null,
    ["L1", "L4"],
    ["macos"],
  ]),
  defineSupplemental(CAPABILITY, [
    "INJECTION-LIFECYCLE-PRELOAD-ASSET-CANONICAL-003",
    "一次性注入是原子完整进程事务",
    null,
    ["L1", "L4"],
    ["macos"],
  ]),
  defineSupplemental(CAPABILITY, [
    "LIVE-CDP-FUSE-001",
    "live 会话兼容禁用 NODE_OPTIONS 的 Electron App",
    null,
    ["L1", "L4"],
    ["macos"],
  ]),
]);
