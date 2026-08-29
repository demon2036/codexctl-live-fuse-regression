## 1. Case Catalog 与预算契约

- [x] 1.1 从两份 spec 的全部 Scenario 建立稳定 case ID 清单，按 config、launch-remote、injection-lifecycle、wallpaper、prompt-context、performance、recovery、platform 和 tdd-gate 分组；验证生成的覆盖报告中 spec Scenario 映射率为 100%。
- [x] 1.2 先编写 catalog validator 的 Red 测试，覆盖重复 ID、非法层级/平台、缺少执行入口、未知预算、必选 case 无测试和孤立核心测试；验证每种故障都因对应断言失败而不是语法或夹具失败。
- [x] 1.3 实现小型 catalog 描述模块、只读聚合器和 validator，让 1.2 全部 Green；运行 `npm run check` 验证每个模块低于 400 行且没有循环依赖。
- [x] 1.4 先编写性能预算 evaluator 的边界 Red 测试，覆盖 750ms 启动预算、p95 的相对/绝对双重容差、max +16ms、CPU +2/+5 个百分点和 invalid 基线；实现统一预算数据与 evaluator 并验证边界值全部 Green。

## 2. Runner、结果与安全归属基础

- [x] 2.1 先为 ownership envelope 编写 Red 测试，覆盖唯一临时根/动态端口、拒绝生产 user-data-dir、PID/start time/command 不匹配、未知进程和两个并发 run；验证错误信息包含精确拒绝原因。
- [x] 2.2 实现 run ID、临时 profile/runtime、端口、进程登记与二次身份校验，让 2.1 Green；通过故障注入验证仅清理本 run 所有资源且主 App/未知进程不受影响。
- [x] 2.3 先为结果 schema 和字段 allowlist 编写 Red 测试，注入 token、Prompt/会话正文、完整环境、绝对用户路径和非法状态；验证 schema/脱敏门禁拒绝泄露或不完整结果。
- [x] 2.4 实现 `summary.json`、`summary.md`、raw metrics/截图索引与 dirty/revision 绑定，让 2.3 Green；修改临时源码 revision 后验证旧结果自动失效。
- [x] 2.5 先为 orchestrator 状态聚合编写 Red 测试，覆盖 pass、fail、unverified、blocked、invalid 耗尽和 cleanup failure；实现选择 case、调用层级 runner、合并结果和退出码，验证任何非完整通过状态都不能输出总体 pass。
- [x] 2.6 为 SIGINT、SIGTERM、子进程异常和 deadline 编写 Red 测试并实现有界事件等待/信号清理；验证没有任意长 sleep、无限轮询、默认 retry 或测试结束后的 profile/socket/worker 残留。

## 3. L1/L2 配置、启动与事务回归

- [x] 3.1 为全新配置的 Prompt=`default`、Context=`native`、官方 provider 和 App 内置 CLI 增加 characterization/Red 用例；若当前行为偏离则先保留 Red 再做最小修复，运行定向测试验证 Green。
- [x] 3.2 为项目级无凭据代理和 `config.toml` 字节级保护增加事务测试，覆盖未知 `crs` provider、shell/launchd/systemd 不持久化和凭据拒绝；验证失败输入不被静默覆盖。
- [x] 3.3 为生产主实例的 user-data-dir/账户身份连续性与隔离测试 profile 分离增加启动计划测试；验证 official/injected 主路径不因 relay、临时 profile 或 PATH CLI 隐藏历史 Sessions。
- [x] 3.4 扩展 official/icon 等价与 embedded CLI 测试，覆盖 macOS 零参数 LaunchServices、无 remote-debugging/注入环境以及 Linux 应用名发现；运行平台计划测试验证 exact launch contract。
- [x] 3.5 先增加旧 primary 完整后代树、重复 app-server/modifier monitor 和未知并行实例的 Red 事务用例；实现或修正最小进程边界后验证新实例接管前旧后代已排空且未知实例 fail closed。
- [x] 3.6a 为 `INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002` 建立有效 Red：模拟导航使旧文档 `executeJavaScript` 悬挂、下一文档 ready，以及父 15 秒先于内层合法阶段到期；实现安装代次中止/重装和共享有界预算，验证成功回执绑定最终 PID/URL/revision、失败包含最后阶段/导航次数/耗时且所有 listener/timer 归零，并在隔离真实 Electron/App 边界 Green。
- [x] 3.6b 扩展注入成功、配置只在下次完整启动生效、重复注入不累积和各阶段失败回退测试；验证 controller 退出、receipt 绑定 PID/revision、回退实例干净且 catalog 对应 case 全部 Green。
- [x] 3.7 先为 Context 切换资格与状态转换编写 L1 Red 测试，覆盖当前已应用容量、同档/增大、明确缩容、compact 阈值倒退、Native 官方容量归一化、未知 Native、幂等、active 排队合并和失败回滚；实现纯判定/状态模块后验证每个分支 Green 且不依赖 DOM、timer 或 App mock 成功。

## 4. L3 真实 Chromium 与 Renderer 契约

- [x] 4.1 将现有 headless Chrome runner 接入 catalog/result schema，并先以故意错误 selector 验证 L3 会 Red；恢复真实 payload 后运行两次，验证结果稳定且只清理自己启动的 Chrome/profile。
- [x] 4.2a 为 Sessions 侧栏收起/展开建立 `WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001`：保留当前 floating surface 被清透明的 L1/L3/L4 Red，验证桌面 docked Sidebar 右边界不越过 Main 左边界、展开减少 Main 可用宽度，并恢复旧版只主题化 docked Sidebar 的选择器边界。
- [x] 4.2b 继续扩展 Wallpaper fixture 为短内容、长内容、多行 composer 和窗口 resize 状态；验证 root/body/viewport 高度、bottom panel 透明、Sidebar/Main/Composer 主题值与有效 Blob 背景全部满足 spec。
- [x] 4.3 增加 Wallpaper 1000 组输入、100 次滚动和流式 DOM 压力用例；验证 observer/timer/layoutReads/reconcile/mutation 计数不增长且 CSS 无 `:has()`、blur、filter、fixed background 或持续动画。
- [x] 4.4 扩展 Prompt/Context 真实 Chrome 场景，覆盖单行到多行 composer、resize、Sessions 切换、host 唯一性、anchor bounds 和菜单可达；验证无 input/scroll 定位监听、MutationObserver、ResizeObserver 或轮询。
- [x] 4.5 增加真实菜单与 request capture 场景，覆盖 Prompt `default`、历史 thread、Developer Prompt 一次性 `Next Base`、Context `native`、272K/258.4K、450K/427.5K 和热切换 pending；验证 Context 菜单与错误中不存在 Prompt 专属的“只对下一个 task 生效”，且 258.4K 绝不确认 450K。
- [x] 4.6 先为当前-thread Context 行为建立真实 Chrome Red：空闲同档/增大立即 resume、active 本轮后且下一请求前应用、连续选择合并、缩容在 unsubscribe 前拒绝、Native 同档/增大不带 override、相同选择零请求、fresh usage 失败回滚；最小修复后捕获请求顺序与 UI 状态并验证全部 Green、无新增 timer/observer/worker。
- [x] 4.7 增加 100 次 Sessions 导航与 1000 组输入压力场景；验证导航 timer 峰值不超过 3、结束后所有 timer 为 0、深层 manager discovery 最多一次且输入前后 ensureSchedules/positionPasses 不增长。

## 5. L4 隔离 App 功能与视觉 A/B

- [x] 5.1 实现隔离 App preflight，检查 App/内置 CLI 版本、所需权限、窗口尺寸、profile 非生产路径和当前主 App 保护；用缺权限、错误 profile 和未知 PID 测试验证返回 unverified/fail 且不启动或操作生产 App。
- [x] 5.2 定义平台中立 App probe 结果接口，并用 fake adapter 先写 Red 测试覆盖 Remote、process tree、visual regions、controls、metrics 和 cleanup；实现 adapter contract 后验证 macOS/Linux driver 可输出同一 schema。
- [x] 5.3 建立 official/injected 等价隔离 fixture 和交替启动序列；验证两边 App/CLI/profile fixture 一致、Remote connected，且没有 WebSocket reset、server already online、重复 presence 或第二 app-server。
- [x] 5.4 实现隔离 App 语义视觉 probe，采集 wallpaper viewport/bottom/sidebar/main/composer 区域、Sidebar/Main 几何关系、控件 bounds、诊断 revision 和脱敏截图；与相同 App/viewport/侧栏状态的 official 基线比较，验证纯黑底、底部黑带、桌面持久 Sidebar 覆盖 Main、控件错位/重复或壁纸超过 750ms 才可见均会稳定 Red。
- [x] 5.5 在真实隔离 App 驱动 Prompt/Context 菜单、composer 扩展与 Sessions 导航，捕获 start/resume 行为和 diagnostics；验证 Developer Prompt 的 Next Base one-shot、Context 当前-thread 同档/增大、active 安全边界、Native、缩容拒绝、窗口映射、失败恢复和零热路径工作在真实 App 继续成立。
- [x] 5.6 连续执行 injected→injected→clean→official 流程并跨完整进程边界采样；验证 revision/host/style/listener 不累积，clean 后无 renderer globals/preload/CDP/worker，Remote 恢复 connected。

## 6. 真实交互性能基准

- [x] 6.1 为 A/B sampler 编写 Red 测试，覆盖预热丢弃、O-I-I-O/I-O-O-I 配对、分位数、离群/系统高负载 invalid、有限重采样和 raw sample 保留；实现 sampler 后用确定性数据验证 Green。
- [x] 6.2 抽取并复用现有 renderer benchmark 的 target 发现、工作负载和计时逻辑，禁止第二套 CDP；通过 loopback/`app://`/target-id 安全测试和脚本语法检查验证复用边界。
- [x] 6.3 在同一 fixture 对 official/injected 执行 launch-to-interactive 与 DOM-ready-to-visible 基准；完成至少两组有效 A/B 并验证中位数 +750ms、p95 750ms 预算及无效基线判定。
- [x] 6.4 对真实 composer 和 Sessions 列表运行固定输入/滚动 workload，恢复原文本与 scrollTop；验证 p50/p95/max、+2ms/15%/+16ms 预算、结果位置和 codexctl 新增 long task 全部纳入判定。
- [x] 6.5 采集 idle 30 秒、输入、滚动和流式压力段的 main/renderer CPU、task/script/style/layout、observer/timer/worker；验证 CPU +2/+5 个百分点预算、controller 已退出和零稳态合同。
- [x] 6.6 在相同最终 revision 上连续运行两轮完整 A/B，验证预算结论可重复；若结论翻转则保持门禁失败并定位噪声或实现不稳定，禁止增加默认 retry。

## 7. L5 macOS 与 Linux 平台验收

- [x] 7.1 先为 macOS 原生 Accessibility/窗口 probe 编写可编译 fixture 与 fake-PID Red 测试，覆盖 PID 绑定、composer 输入、Sessions 滚动、bounds、截图权限和停止清理；实现小型 probe 并验证缺权限只产生明确 unverified。
- [ ] 7.2 在 macOS 隔离 official/preload App 上运行 L5，验证 LaunchServices 零参数、无 DevTools、内置 CLI、Remote、真实视觉/交互预算、完整重启恢复和零残留，并保存脱敏结果。
- [ ] 7.3 扩展 Linux package/app-name discovery 与 loopback CDP L5 driver 测试，覆盖 Codex/ChatGPT 名称、非 loopback endpoint、错误 target 和连接关闭；在实际 Linux 发行包上运行后验证 Remote、视觉/交互预算与零持久状态。
- [x] 7.4 实现平台矩阵聚合，验证缺失 macOS 或 Linux 实际结果时对应平台为 unverified 且“全平台通过”为 false；只有两个声明支持的平台都绑定最终 revision 后才允许全平台 pass。

## 8. TDD 门禁与已发现偏差处理

- [x] 8.1 为 defect/characterization 两类 case 的证据校验先写 Red 测试，覆盖缺 parent revision、Red 因错误原因失败、Green revision 不匹配和纯重构伪造 Red；实现证据校验后验证错误信息可操作。
- [x] 8.2 对本 change 新暴露的每个产品偏差保留最小 Red、记录 case ID 和失败原因，再做职责最小的生产修复；逐项验证定向测试、邻近层和 `npm run test:fast` Green，不能先改预算或断言。
- [x] 8.3 在相关 case 全绿后按职责重构达到 320 行预警/400 行硬上限，验证无压行、循环依赖、新 watcher/observer/轮询或不对称 cleanup，并再次运行受影响 L1-L4。
- [x] 8.4 用临时故障注入分别破坏 provider、bottom transparency、anchor、Remote receipt、预算和 cleanup，验证每个核心门禁确实 Red；撤销故障后重跑，确认没有测试只因 mock 或文案映射而假 Green。

## 9. 命令、CI 与文档对齐

- [x] 9.1 在 `package.json` 增加 `test:fast`、`test:app`、`test:platform` 和 `test:regression`，保留现有命令；逐个运行 `--help`/选择 case 和失败退出码测试，验证入口一致且无隐藏副作用。
- [x] 9.2 将 catalog/schema、`.skip`/`.only`、重复/孤立 ID、预算 key、结果隐私和 400 行检查接入 `npm run check`；用逐项故障 fixture 验证任何违规都会阻止通过。
- [x] 9.3 更新 TESTING、CODE_SOP 和架构文档，以生成的 catalog 摘要代替重复手写清单；运行文档链接/命令校验并确认文档描述与真实 CLI、层级和状态语义一致。
- [ ] 9.4 配置 GitHub 快速层与可用平台 runner：普通 CI 运行 L1-L3，具备 App/权限的专用 runner 运行 L4/L5；验证无平台权限时报告 unverified 而不是伪造 pass，日志和 artifact 不含敏感数据。

## 10. 最终回归与交付判定

- [ ] 10.1 对最终 revision 运行 `npm run check`、`npm test`、`npm run test:browser` 和 `npm run test:fast`，验证全部 case Green、无 skip/only、无文件超过 400 行且 Git diff 无敏感信息或机器绝对路径。
- [ ] 10.2 在不操作用户主 App 的前提下运行两轮 `npm run test:app` 和当前平台 `npm run test:platform`，验证功能、视觉、Remote、性能、完整恢复和零残留结果绑定同一最终 revision。
- [ ] 10.3 运行 `npm run test:regression` 汇总并校验 `summary.json`/`summary.md`，验证 pass/fail/unverified 平台矩阵准确、所有必选 case 有证据、raw metrics 可复现且结果目录已脱敏。
- [ ] 10.4 执行 `openspec validate codify-regression-tdd --strict` 和最终工作区检查，验证规划规格、实现、测试、文档与结果一致；任何源码变动后必须重新执行受影响门禁。
- [ ] 10.5 仅在开发者自测的全部必选门禁通过后向用户请求主 App 最终验证窗口，提前说明是否需要完整重启；未经明确授权继续保持主 App不受触碰，用户确认作为额外验收而不是替代自动回归。
