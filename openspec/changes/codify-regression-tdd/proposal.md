## Why

现有测试已经覆盖不少底层逻辑，但缺少一份从用户体验出发、可执行且有统一门禁的回归契约，导致“单测通过”仍可能出现启动卡顿、输入或滚动掉帧、壁纸底部黑块、Prompt/Context 错位、Remote 失联或残留进程。现在需要把这些反复出现的问题转成稳定的自动化测试，并以 TDD 作为所有修复和重构的默认开发方式。

## What Changes

- 建立版本化的核心回归矩阵，覆盖配置、启动事务、单实例、Remote、一次性注入、Wallpaper、Prompt/Context、清理恢复、安全边界以及 macOS/Linux 平台差异。
- 建立分层测试门禁：快速单元/契约测试、事务集成测试、真实 Chromium 测试、隔离 App 官方与注入 A/B，以及发布前平台验收；清单项必须有可执行测试或明确证据，不能只写在文档里。
- 为启动、打字、Sessions 滚动、long task、稳态 CPU、observer/timer/worker 和残留进程定义可重复的量化预算，以同版本官方 App 为基线控制环境噪声。
- 将视觉正确性纳入核心回归：壁纸覆盖完整 viewport 和 bottom panel，Sidebar/Main/Composer 对比度可用；桌面持久 Sessions 侧栏展开时参与 shell 布局并推开 Main，不得与中间内容重叠；Prompt/Context 控件随 composer 移动且不重复、不消失。
- 将 Prompt 默认值 `default`、Context 默认值 `native`、Developer Prompt 的 `Next Base` one-shot 语义、Context 对当前 thread 的非缩容实时切换，以及 272K/450K 配置窗口与 258.4K/427.5K 有效窗口映射写成不可含糊的行为契约；Context/Native 不得复用“只对下一个 task 生效”的 Prompt 文案。
- 将 Remote-safe 启动、App 内置 CLI、官方 provider、项目级无凭据代理、macOS preload 导航中止/重装与共享有界 deadline、失败回退和完整进程边界写成发布阻断条件。
- 采用严格 TDD：每个缺陷先提交能在修复前失败的最小回归测试，再做最小实现并在全绿后重构；禁止通过放宽断言、跳过用例、无限重试或只验证 mock 来掩盖真实回归。
- 生成机器可读的回归结果摘要，记录环境、App/CLI 版本、PID、基线与注入指标、视觉/功能断言、残留状态和失败原因，便于复现和审阅。
- 测试只操作隔离 profile 和精确归属的进程；用户正在工作的主 App 未经明确授权不得被启动、关闭、注入、点击或读取。

## Capabilities

### New Capabilities

- `app-experience-regression`: 定义 Codex/ChatGPT App 从启动、连接、注入、视觉、Prompt/Context 到交互性能、恢复和跨平台行为的完整回归契约。
- `tdd-quality-gate`: 定义测试先行、分层门禁、可复现证据、反脆弱规则和交付判定流程。

### Modified Capabilities

- 无。

## Impact

- 主要影响测试目录、测试运行脚本、`package.json` 命令、测试夹具、性能/视觉基线、CI 或发布流程以及测试文档。
- 需要在 macOS 使用隔离 App 完成 LaunchServices/preload/Remote 验收，在 Linux 使用实际发行包完成 loopback CDP 与应用发现验收；无平台环境时必须明确标记为未验证，不能伪装成通过。
- 本 change 明确修正 Context 当前-thread 语义和对应 UI 文案；实施阶段 SHALL 先以回归测试暴露现有偏差，再最小修复产品行为。静态 YAML/CLI 注入配置仍遵守完整重启边界，不得借此引入运行期 watcher。
- 所有新增文本文件继续受每文件不超过 400 行、无持久 watcher/observer/worker、无用户凭据和机器绝对路径的现有硬约束。
