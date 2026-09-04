# 回归 Case Catalog

> 此文件由 `npm run catalog` 从 `regression/catalog/` 生成；请勿手工维护条目。

共 75 个必选 case：72 个 OpenSpec Scenario，3 个补充门禁。

| Case ID | Capability | Scenario | 层级 | 平台 | 预算 | 执行入口 |
| --- | --- | --- | --- | --- | --- | --- |
| `CONFIG-DEFAULTS-001` | app-experience-regression | 全新 codexctl 配置使用正确默认值 | L1 | all | — | npm run test:fast |
| `CONFIG-PROXY-SCOPE-002` | app-experience-regression | 项目代理保持局部且无凭据 | L1 / L2 | all | — | npm run test:fast |
| `CONFIG-PROVIDER-PRESERVE-003` | app-experience-regression | 未知 provider 不由 codexctl 注入 | L1 / L2 | all | — | npm run test:fast |
| `CONFIG-SESSION-IDENTITY-004` | app-experience-regression | 主实例保持历史会话身份 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `LAUNCH-OFFICIAL-ICON-EQUIVALENCE-001` | app-experience-regression | Official 启动等价于图标启动 | L2 / L5 | macos / linux | — | npm run test:fast<br>npm run test:platform |
| `LAUNCH-REMOTE-INJECTED-002` | app-experience-regression | 注入启动保持 Remote 可连接 | L2 / L4 / L5 | macos / linux | — | npm run test:fast<br>npm run test:app<br>npm run test:platform |
| `LAUNCH-DESCENDANT-DRAIN-003` | app-experience-regression | 替换旧实例时排空完整后代树 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `LAUNCH-UNKNOWN-INSTANCE-004` | app-experience-regression | 未知并行实例安全失败 | L2 | all | — | npm run test:fast |
| `INJECTION-ONE-SHOT-CONTROLLER-001` | app-experience-regression | 成功注入后无常驻控制器 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `INJECTION-STATIC-RESTART-002` | app-experience-regression | 静态注入配置变更延迟到下次完整启动 | L1 / L2 | all | — | npm run test:fast |
| `INJECTION-REPEAT-NO-ACCUMULATION-003` | app-experience-regression | 重复注入不累积状态 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002` | app-experience-regression | macOS preload 在启动导航后仍有界完成 | L1 / L2 / L4 / L5 | macos | — | npm run test:fast<br>npm run test:app<br>npm run test:platform |
| `INJECTION-ROLLBACK-OFFICIAL-004` | app-experience-regression | 半安装失败回退到干净官方实例 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001` | app-experience-regression | 补充质量门禁 | L1 / L4 | macos | — | npm run test:fast<br>npm run test:app |
| `INJECTION-LIFECYCLE-PRELOAD-ASSET-CANONICAL-003` | app-experience-regression | 补充质量门禁 | L1 / L4 | macos | — | npm run test:fast<br>npm run test:app |
| `LIVE-CDP-FUSE-001` | app-experience-regression | 补充质量门禁 | L1 / L4 | macos | — | npm run test:fast<br>npm run test:app |
| `WALLPAPER-FIRST-VISIBLE-001` | app-experience-regression | 首次可交互时壁纸及时可见 | L1 / L3 / L4 | all | startup-visible | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `WALLPAPER-BOTTOM-COVERAGE-002` | app-experience-regression | Bottom panel 不再露出黑底 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `WALLPAPER-THEME-SEMANTICS-003` | app-experience-regression | Sidebar 与内容区保持主题语义 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001` | app-experience-regression | 桌面 Sessions 侧栏展开时推开主内容 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `WALLPAPER-ZERO-HOTPATH-004` | app-experience-regression | Wallpaper 稳态不响应输入和滚动 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `PROMPT-CONTEXT-ANCHOR-001` | app-experience-regression | 控件随 composer 扩展而定位正确 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `PROMPT-DEFAULT-THREAD-002` | app-experience-regression | Prompt 默认值和当前 thread 保持明确 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `PROMPT-NEXT-BASE-003` | app-experience-regression | Developer Prompt 的 Next Base 只消费一次 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-COPY-SEMANTICS-001` | app-experience-regression | Context 文案不继承 Prompt one-shot 语义 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `PROMPT-CONTEXT-NAVIGATION-PERF-004` | app-experience-regression | 高频导航和输入不增加后台工作 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-NATIVE-NO-OVERRIDE-002` | app-experience-regression | Native Context 不覆盖官方字段 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-IDLE-MONOTONIC-003` | app-experience-regression | 空闲 thread 的合法目标立即生效 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-ACTIVE-SAFE-BOUNDARY-004` | app-experience-regression | 正在生成时在当前 thread 的安全边界生效 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-QUEUE-COALESCE-005` | app-experience-regression | 连续选择只应用最后一个合法目标 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `CONTEXT-SHRINK-APPLY-006` | app-experience-regression | 缩小 Context 并在需要时标记下轮 compact | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-NATIVE-COMPARABLE-007` | app-experience-regression | Native 参与相同的容量判定 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-NATIVE-UNKNOWN-008` | app-experience-regression | Native 容量无法可靠解析 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `CONTEXT-IDEMPOTENT-009` | app-experience-regression | 选择当前 Context 是幂等操作 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `CONTEXT-WINDOW-MAPPING-010` | app-experience-regression | 272K 和 450K 映射准确 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `CONTEXT-PENDING-FRESH-USAGE-011` | app-experience-regression | 热切换期间展示区分配置值与有效值 | L1 / L3 / L4 | all | — | npm run test:fast<br>npm run test:browser<br>npm run test:app |
| `PERFORMANCE-STARTUP-001` | app-experience-regression | 注入不显著延迟可交互 | L4 / L5 | macos / linux | startup | npm run test:app<br>npm run test:platform |
| `PERFORMANCE-INPUT-002` | app-experience-regression | 打字延迟保持丝滑 | L3 / L4 / L5 | macos / linux | input | npm run test:browser<br>npm run test:app<br>npm run test:platform |
| `PERFORMANCE-SCROLL-003` | app-experience-regression | Sessions 滚动延迟保持丝滑 | L3 / L4 / L5 | macos / linux | scroll | npm run test:browser<br>npm run test:app<br>npm run test:platform |
| `PERFORMANCE-CPU-004` | app-experience-regression | 稳态 CPU 与任务数量无回归 | L3 / L4 / L5 | macos / linux | cpu | npm run test:browser<br>npm run test:app<br>npm run test:platform |
| `PERFORMANCE-INVALID-BASELINE-005` | app-experience-regression | 基线噪声使结果无效 | L1 / L4 | all | baseline-validity | npm run test:fast<br>npm run test:app |
| `RECOVERY-CLEAN-RESTART-001` | app-experience-regression | Clean 后恢复官方状态 | L2 / L4 / L5 | macos / linux | — | npm run test:fast<br>npm run test:app<br>npm run test:platform |
| `RECOVERY-HOT-CLEAN-NOT-SUFFICIENT-002` | app-experience-regression | 热撤销后仍卡不被误判修复 | L1 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `RECOVERY-OWNED-CLEANUP-003` | app-experience-regression | 清理只作用于精确归属资源 | L2 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `PLATFORM-MACOS-IDENTITY-001` | app-experience-regression | macOS 使用官方进程身份 | L2 / L5 | macos | — | npm run test:fast<br>npm run test:platform |
| `PLATFORM-LINUX-LOOPBACK-002` | app-experience-regression | Linux 使用受限一次性连接 | L2 / L5 | linux | — | npm run test:fast<br>npm run test:platform |
| `PLATFORM-MISSING-UNVERIFIED-003` | app-experience-regression | 缺少平台执行环境 | L1 | all | — | npm run test:fast |
| `PLATFORM-LINUX-WORKSPACE-ROUTE-004` | app-experience-regression | Linux 实际包进入隔离工作区 | L1 / L5 | linux | — | npm run test:fast<br>npm run test:platform |
| `PLATFORM-LINUX-RENDERER-SURFACE-005` | app-experience-regression | Linux 实际包进入隔离工作区 | L1 / L5 | linux | — | npm run test:fast<br>npm run test:platform |
| `PLATFORM-MACOS-INTERACTIVE-ACTIVATION-006` | app-experience-regression | macOS 使用官方进程身份 | L1 / L5 | macos | — | npm run test:fast<br>npm run test:platform |
| `TDD-RED-EVIDENCE-001` | tdd-quality-gate | 缺陷修复的 Red 证据有效 | L1 | all | — | npm run test:fast |
| `TDD-UNAUTOMATABLE-BOUNDARY-002` | tdd-quality-gate | 无法自动化的缺陷先定义可执行边界 | L1 | all | — | npm run test:fast |
| `TDD-CHARACTERIZATION-003` | tdd-quality-gate | 纯重构使用 Characterization 测试 | L1 | all | — | npm run test:fast |
| `TDD-GREEN-MINIMAL-004` | tdd-quality-gate | 最小实现通过相关测试 | L1 | all | — | npm run test:fast |
| `TDD-BUDGET-INDEPENDENT-005` | tdd-quality-gate | 修改预算或期望值需要独立决策 | L1 | all | — | npm run test:fast |
| `TDD-REAL-BOUNDARY-006` | tdd-quality-gate | Mock 不能替代真实边界 | L1 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `TDD-FILE-LIMIT-007` | tdd-quality-gate | 文件接近上限时按职责拆分 | L1 | all | — | npm run test:fast |
| `TDD-ZERO-STEADY-STATE-008` | tdd-quality-gate | 性能敏感重构保持零稳态合同 | L1 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `TDD-FAST-GATE-009` | tdd-quality-gate | 日常修改执行快速层 | L1 / L2 / L3 | all | — | npm run test:fast<br>npm run test:browser |
| `TDD-APP-AB-GATE-010` | tdd-quality-gate | App 边界修改执行隔离 A/B | L4 | all | — | npm run test:app |
| `TDD-PLATFORM-GATE-011` | tdd-quality-gate | 发布候选执行目标平台验收 | L5 | macos / linux | — | npm run test:platform |
| `TDD-CATALOG-NEW-CASE-012` | tdd-quality-gate | 新回归场景加入目录 | L1 | all | — | npm run test:fast |
| `TDD-CATALOG-MISSING-TEST-013` | tdd-quality-gate | 测试被删除或改名 | L1 | all | — | npm run test:fast |
| `TDD-CROSS-LAYER-MAPPING-014` | tdd-quality-gate | 同一行为跨层覆盖 | L1 | all | — | npm run test:fast |
| `TDD-OWNERSHIP-CONCURRENT-015` | tdd-quality-gate | 并发测试互不污染 | L1 / L2 | all | — | npm run test:fast |
| `TDD-PROTECT-MAIN-APP-016` | tdd-quality-gate | 用户主 App 正在工作 | L1 / L4 | all | — | npm run test:fast<br>npm run test:app |
| `TDD-CLEANUP-ON-FAILURE-017` | tdd-quality-gate | 测试异常退出 | L1 / L2 | all | — | npm run test:fast |
| `TDD-BOUNDED-DEADLINE-018` | tdd-quality-gate | 条件在超时内未满足 | L1 / L2 | all | — | npm run test:fast |
| `TDD-INVALID-SAMPLE-019` | tdd-quality-gate | 性能样本被判为无效 | L1 | all | baseline-validity | npm run test:fast |
| `TDD-RESULT-SUCCESS-020` | tdd-quality-gate | 完整回归成功 | L1 / L2 | all | — | npm run test:fast |
| `TDD-RESULT-NONPASS-021` | tdd-quality-gate | 任一必选 case 未通过 | L1 / L2 | all | — | npm run test:fast |
| `TDD-APP-UNVERIFIED-022` | tdd-quality-gate | 自动测试通过但真实 App 未验证 | L1 | all | — | npm run test:fast |
| `TDD-USER-ACCEPTANCE-023` | tdd-quality-gate | 开发者自测完成后请求用户确认 | L1 | all | — | npm run test:fast |
| `TDD-REVISION-CONSISTENCY-024` | tdd-quality-gate | 工作区或结果与 revision 不一致 | L1 / L2 | all | — | npm run test:fast |
| `TDD-FIXTURE-DRAIN-025` | tdd-quality-gate | fixture 进程晚于临时目录退出 | L1 / L2 | all | — | npm run test:fast |

行为真相来源：

- [App 体验回归规格](../openspec/changes/codify-regression-tdd/specs/app-experience-regression/spec.md)
- [TDD 质量门禁规格](../openspec/changes/codify-regression-tdd/specs/tdd-quality-gate/spec.md)
- [测试执行说明](TESTING.md)
