# 本 change 的产品偏差与 Red/Green 索引

本文件只登记实际用户边界偏差；原本已满足规格的行为使用 characterization 测试，不伪造 Red。所有 Red 都绑定修复前 parent revision，Green 由最终 `test:regression` 的 revision-bound case 结果补足，源码或 dirty 状态改变后自动失效。

默认 parent revision：`8ac47fc14e0a4c70021a10213bc9b180d9193299`。

## 1. macOS preload 导航与父 deadline 冲突

- Case：`INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002`
- Red：`node --test test/macos-preload-hook.test.mjs test/macos-preload-runtime.test.mjs`
- 预期失败：旧文档 `executeJavaScript` 悬挂后，新文档无法安装并最终出现 `macOS preload 未在 15 秒内返回`；父事务仍有独立固定 15 秒等待。
- 最小修复：安装代次可中止，最终文档单次重装；hook/父事务共享只读预算；失败带 stage/navigation/elapsed，listener/timer 对称释放。
- 详细证据：[preload navigation/deadline](injection-lifecycle-preload-navigation-deadline-002.md)。

## 2. LaunchServices 丢失 preload 环境

- Case：`LAUNCH-OFFICIAL-ICON-EQUIVALENCE-001`、`INJECTION-LIFECYCLE-PRELOAD-NAVIGATION-DEADLINE-002`
- Red：`node scripts/macos-platform-regression.mjs --injected --json`
- 预期失败：仅依赖 `open` 子进程环境时，GUI App 没有绑定 owned profile/spec/result，表现为 profile deadline 或 preload 无回执。
- 最小修复：生产路径仍不向 App 转发 argv；允许的单次环境通过 LaunchServices `--env KEY=VALUE` 显式传递并在 hook 最早期删除。

## 3. 无 composer 页面被误判为安装失败

- Case：`INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001`
- Red：`node --test test/macos-preload-runtime.test.mjs`
- 预期失败：runtime 与模块 revision 已安装，但登录/首页没有 composer，5 秒后错误报告 Prompt/Context 控件不可见。
- 最小修复：diagnostics 明确 `controlContextAvailable=false`；仅在两个按钮均为 0 时接受 dormant，存在 composer 时仍严格要求唯一且可见的控件。

## 4. 旧 app-server/helper 未在替换前排空

- Case：`LAUNCH-DESCENDANT-DRAIN-003`
- Red：`node --test test/app-process-boundary.test.mjs`
- 预期失败：旧 primary 退出后，脱离 parent tree 的 app-server 或 modifier helper 可与新实例短暂并存。
- 最小修复：按 bundle/executable 识别 detached app-server/monitor，二次身份校验并在新实例接管前排空；未知进程继续 fail closed。

## 5. Bottom 黑带和 Sidebar 布局语义

- Case：`WALLPAPER-BOTTOM-COVERAGE-002`、`WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001`
- Red：`node scripts/browser-regression.mjs --fault=bottom-selector` 与 `node --test test/wallpaper-lite.test.mjs`
- 预期失败：bottom surface 保留 `rgb(17, 17, 17)`；Wallpaper selector 接管 floating Sidebar 后与 Main 视觉重叠。
- 最小修复：覆盖真实 bottom/thread fade surface；只主题化 docked Sidebar，不修改官方 flex/position/width，不用更深黑色掩盖重叠。
- 详细证据：[browser selector Red](browser-selector-red.md)、[Sidebar geometry](wallpaper-sidebar-docked-geometry-001.md)。

## 6. Context 被错误描述为只影响下一个 task

- Case：`CONTEXT-IDLE-MONOTONIC-003`、`CONTEXT-ACTIVE-SAFE-BOUNDARY-004`、`CONTEXT-QUEUE-COALESCE-005`
- Red：`node --test test/context-switch-policy.test.mjs test/context-window-runtime.test.mjs` 与 `npm run test:browser`
- 预期失败：当前 thread 的合法同档/增大目标被延迟到新 task，active 文案复用 Prompt one-shot，连续选择可能产生多个意图。
- 最小修复：纯单调容量判定；idle 立即 resume，active 在既有请求生命周期的下一安全边界只应用最后目标，文案为“本轮完成后应用到当前 task”。

## 7. Native 与 effective-window 判断不准确

- Case：`CONTEXT-NATIVE-COMPARABLE-007`、`CONTEXT-NATIVE-UNKNOWN-008`、`CONTEXT-WINDOW-MAPPING-010`、`CONTEXT-PENDING-FRESH-USAGE-011`
- Red：`node --test test/context-window-runtime.test.mjs` 与 `npm run test:browser`
- 预期失败：Native 被无条件当成 next-task-only；旧 258.4K usage 可能确认 450K，或旧 usage 在 fresh 结果到来前错误回滚。
- 最小修复：Native 先归一为可信官方容量；272K/450K 只匹配自身或精确 95% effective 值；旧 usage 只保持 pending，fresh mismatch 才回滚。

## 8. 无效 provider 与官方配置连续性

- Case：`CONFIG-PROVIDER-PRESERVE-003`
- Red：`node --test test/config-boundaries.test.mjs test/config-transaction.test.mjs`
- 预期失败：旧 `crs` provider 输入可能被启动逻辑覆盖或继续注入，导致官方 thread 无法加载且原文件难以恢复。
- 最小修复：启动计划不写 provider；字节级比较 `config.toml`，非法输入以可操作错误停止并保留原文件。

## 9. 热撤销被误当成性能恢复

- Case：`RECOVERY-HOT-CLEAN-NOT-SUFFICIENT-002`、`RECOVERY-CLEAN-RESTART-001`
- Red：`node --test test/regression-app-sequence.test.mjs`
- 预期失败：只删除 DOM/global 的结果也可能被标记为 clean，忽略 renderer heap/framework/compositor 残留。
- 最小修复：恢复门禁要求明确的完整进程边界，再验证 official 无 preload/CDP/global/worker、Remote connected 和零残留。

## 10. Linux 发行包身份漂移

- Case：`PLATFORM-LINUX-LOOPBACK-002`
- Red：`node --test test/launch-contract.test.mjs test/regression-linux-platform-contract.test.mjs`
- 预期失败：只识别小写 `chatgpt` launcher，无法接受真实包显示为 ChatGPT/Codex 或不同受支持布局。
- 最小修复：发现受支持包名并解析稳定 executable/内置 CLI；CDP 仍只允许 loopback、匹配 `app://` target 且一次性关闭。

## 11. macOS 测试实例退出后仍可能有晚到 helper

- Case：`RECOVERY-OWNED-CLEANUP-003`、`TDD-CLEANUP-ON-FAILURE-017`
- Red：`node scripts/macos-platform-regression.mjs --official --json` 后立即按 run envelope 扫描进程。
- 预期失败：App 主进程与已快照后代退出后，插件同步 `git fetch` 可被 PID 1 收养并短暂保留；旧清理只检查 main/profile，错误报告零残留。
- 最小修复：按精确、规范化 envelope 路径识别晚到进程，使用 PID/start time/command 二次校验，在有限次数内终止并要求连续两次空扫描；相似前缀和用户主实例不匹配。

## 12. L5 不得复制生产 profile 获得假登录态

- Case：`TDD-PROTECT-MAIN-APP-016`、`PLATFORM-MACOS-IDENTITY-001`
- Red：`node --test test/regression-macos-platform-runtime.test.mjs`
- 预期失败：旧 `--seed-profile` 会复制浏览器 profile、`auth.json`、Sessions index 与 SQLite 状态到测试根，既违反隐私边界，也让所谓隔离测试读取真实用户状态。
- 最小修复：删除该入口和全部复制逻辑；L5 只使用全新 owned profile，缺登录/交互前提明确报告 unverified，绝不以生产数据换取 Green。

## 13. 性能基准的帧相位与非稳态 CPU 会制造结论翻转

- Case：`PERFORMANCE-INPUT-002`、`PERFORMANCE-SCROLL-003`、`PERFORMANCE-CPU-004`、`TDD-INVALID-SAMPLE-019`
- Red：`npm run test:performance`；两轮真实 A/B 的 scroll 结论都失败且 input 结论翻转，stream 的 Performance task/layout 更低却被区间 p50 判为 CPU 回归。
- 预期失败：输入/滚轮随机落在刷新帧前后，使 2–17ms 的相位差被误算为注入开销；不断增长且过早结束的 stream DOM 让 CPU 区间从低到高爬坡、样本 p95 退化为单点 max，O-I-I-O 各段的时间位置差异改变 p50；把 GPU/helper 汇入 spec 只约束 main/renderer 的预算还会制造结论翻转。
- 最小修复：输入和滚动在相同 animation-frame 边界派发；stream 固定运行 12 秒并维持有上限的 live DOM；fixture deadline 覆盖完整样本；CPU 同时完成 O-I-I-O 与反向 I-O-O-I 两组，median 比较完整 segment 的归一化均值且使用标准偶数中位数，p95 仍比较每段原始区间 p95；main/renderer 分别对四个 official 与四个 injected 样本执行 +2/+5 聚合预算，两组结论继续作为顺序敏感性诊断；GPU/helper/total 与 task/script/style/layout 保留为诊断聚合；系统/App 外部 CPU 全量保留，高外部负载标为 invalid 并最多重采样一次，稳定产品 fail 不重试，预算不变。

## 14. macOS L5 交互只验证布尔结果而没有预算证据

- Case：`PERFORMANCE-STARTUP-001`、`PERFORMANCE-INPUT-002`、`PERFORMANCE-SCROLL-003`、`PERFORMANCE-CPU-004`、`PLATFORM-MACOS-IDENTITY-001`
- Red：`node --test test/regression-macos-platform-sequence.test.mjs test/regression-macos-native-probe.test.mjs`
- 预期失败：原生 probe 只返回一次输入/滚动是否成功，sequence 在没有 latency/CPU 样本时仍可 pass，导致 catalog 声明的 L5 性能场景没有实际预算判定。
- 最小修复：原生 probe 各采集 20 个可恢复延迟样本；official→injected→official 使用统一 startup/input/scroll 预算；外部采样真实 App 进程树的 idle/input/scroll/content-growth CPU。缺样本、恢复失败或预算超限分别成为 fail，高系统负载保持 unverified。

## 15. 壁纸全屏 paint 在软件渲染下拖慢输入

- Case：`PERFORMANCE-INPUT-002`、`PERFORMANCE-CPU-004`、`WALLPAPER-ZERO-HOTPATH-004`
- Parent revision：`78adc6be6e03faf78efe1a5eba067ea60a3c3baf`。
- Red：`npm run test:performance` 与 `node scripts/performance-component-regression.mjs --component wallpaper`（GitHub run `33097931663`）；本机以 `CODEXCTL_TEST_ELECTRON_CI=1` 运行相同 Wallpaper-only input A/B 复现。
- 预期失败：Linux/software renderer 的 Wallpaper-only input renderer p50 为 `26.78%`、p95 为 `36.71%`，official 分别为 `19.97%`、`25.27%`，两个相反顺序组都失败；Controls-only 同场景通过，证明偏差属于 Wallpaper paint，而不是 Prompt/Context 或测试噪声。
- 最小修复：根背景移入受 `contain: strict` 约束的单一静态合成面；动态 thread 区建立 layout/paint 边界；composer 的半透明背景与输入内容拆成独立小 paint plane。实现不增加 DOM 节点、observer、timer、listener、worker 或 controller，预算保持原值。

## 16. 隔离 composer paint plane 被视觉探针误判

- Case：`WALLPAPER-THEME-SEMANTICS-003`、`TDD-REAL-BOUNDARY-006`
- Parent revision：`78adc6be6e03faf78efe1a5eba067ea60a3c3baf`。
- Red：`npm run test:app`，run `app-67dce91a-1c1a-44d3-80e9-ae00048d9e15`。
- 预期失败：真实隔离 App 截图和 computed style 显示 composer 的 `::before` 为主题半透明色、主体按设计透明，但旧 L4 probe 只读取主体 background 并稳定返回 `composer-not-themed`；其余 sequence、interaction、fault 和 cleanup 门禁均通过。
- 最小修复：L4/L5 共用纯视觉 paint 分类器；仅当主体透明时读取声明的隔离伪元素 paint layer，主体不透明黑仍优先判失败。定向单测覆盖透明继承和黑色不被遮蔽，真实 L4 再次穿过 Electron 边界 Green。

## 17. Sidebar 半透明 paint 与滚动内容共用失效域

- Case：`PERFORMANCE-SCROLL-003`、`WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001`、`WALLPAPER-ZERO-HOTPATH-004`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`f2fa69858004ced71cc2e63e239446bf8bcf3f8e`。
- Red：在同一 clean revision 连续执行 `npm run test:performance`；run `performance-7bbe0a6f-f743-46bb-a230-15320046dacb` 首轮通过，run `performance-bf657f25-1416-4ac0-bae9-4814b08a65b1` 次轮因两次 interaction 的 Sidebar scroll p95 均超预算而失败。随后以 `runAppPerformanceAB` 定向复现，只有 `contain: paint` 的候选仍出现一次通过、一次失败的结论翻转。GitHub run `33102660872` 的软件渲染完整模块 A/B 还暴露 input/stream renderer CPU 失败，而 Controls-only 与 Wallpaper-only 组件均通过。
- 预期失败：第二个本机完整 run 的 injected scroll p95 为 `20.70ms`，official 为 `17.40ms`，超过不变的 `max(official × 1.15, official + 2ms)` 上限。旧 CI 完整模块的 input renderer p50 为 `19.25%`、official 为 `17.10%`，stream renderer p50 为 `32.51%`、official 为 `30.44%`，两者顺序稳定性均 mixed；这说明 Sidebar 静态 paint 与动态内容仍共享失效域，而不是 controller 或单个模块的热路径工作。
- 最小修复：只在官方 docked Sidebar 的既有滚动容器建立 paint containment，并声明浏览器原生 `scroll-position` 变化提示，使半透明静态主题与动态内容的重绘边界分离；不修改 position、width、flex、transform 或滚动语义，不增加 DOM、listener、observer、timer、worker 或重试。定向真实 Electron interaction A/B 连续三轮的 startup/input/scroll 预算均 Green；软件渲染完整模块 input/stream 的 main/renderer 与正反顺序预算全部 Green，最终 revision 仍须执行两轮完整 A/B。

## 18. L3 把经典 scrollbar gutter 误判成 Wallpaper 缺口

- Case：`WALLPAPER-BOTTOM-COVERAGE-002`、`TDD-REAL-BOUNDARY-006`、`TDD-PLATFORM-GATE-011`。
- Parent revision：`f2fa69858004ced71cc2e63e239446bf8bcf3f8e`。
- Red：GitHub run `33102660872` 在 macOS 15 与 Ubuntu 24.04 的 `npm run test:browser` 同时失败；`assertWallpaper` 得到 root paint plane 宽度 `985px`、`window.innerWidth` `1000px`，本机 overlay scrollbar 环境则通过。
- 预期失败：fixture 的长内容触发 `15px` 经典 scrollbar gutter；绝对 paint plane 的 `100%` 正确覆盖 layout viewport `documentElement.clientWidth=985px`，旧断言却要求覆盖包含 scrollbar UI 的 `innerWidth=1000px`。这是跨平台测试坐标系错误，不是页面出现 15px 黑带；直接改成 `100vw` 还可能制造横向 overflow。
- 最小修复：L3 同时记录 visual viewport、layout viewport、document scrollWidth 和 gutter；paint plane 必须精确覆盖 layout viewport，高度覆盖可见 viewport，document 不得横向溢出，且 visual/layout 差只能等于非负 scrollbar gutter。视觉契约不放宽，也不修改生产 Wallpaper 尺寸或性能实现。

## 19. CSS anchor 控件子树参与动态内容 layout

- Case：`PERFORMANCE-INPUT-002`、`PERFORMANCE-CPU-004`、`PROMPT-CONTEXT-ANCHOR-001`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`0d281c51c6ba5dfdd8689079385617e7e2401a8e`。
- Red：GitHub run `33105512560` 的 Controls-only 软件渲染 A/B 在两个相反顺序组均复现 input renderer CPU 超限；同一 run 的完整模块 stream renderer 在两个顺序组也均失败，而 Wallpaper-only 的 input/stream 全部通过。
- 预期失败：Controls-only input renderer p50 为 `24.49%`、official 为 `22.33%`，超过 +2 个百分点预算；完整模块 stream renderer p50 为 `41.96%`、official 为 `38.72%`。Performance metrics 同时显示 Controls-only input layout p50 为 `376.86ms`、official 为 `250.89ms`，说明 body-level CSS anchor host 的内部布局仍被 composer 与主内容变化反复牵连。
- 最小修复：保留原生 CSS anchor、body-level React 隔离和无 input/scroll listener 合同，只为唯一 control host 建立 `layout paint` containment，使两个按钮的内部 layout/paint 不向动态 App 内容传播；不增加 size containment、transform、observer、timer、worker 或重试。定向单测、L3、L4 均 Green；软件渲染 Controls-only input 和完整模块 stream 的 main/renderer 与正反顺序预算全部 Green。

## 20. 交互 A/B 使用宿主一分钟 load average 误杀有效样本

- Case：`PERFORMANCE-INVALID-BASELINE-005`、`TDD-INVALID-SAMPLE-019`、`TDD-PLATFORM-GATE-011`。
- Parent revision：`0d281c51c6ba5dfdd8689079385617e7e2401a8e`。
- Red：本机 run `performance-3a4c41ff-3717-4b56-8090-cc1f57b0092c` 与 GitHub run `33105512560` 的两轮 interaction 均在有限重采样后得到 `system-high-load`，但同一 run 的实际 CPU 分段 main/renderer 四阶段全部通过；测试显示旧实现直接读取 `os.loadavg()`，无法表示当前样本区间。
- 预期失败：一分钟 load average 会携带采样前的构建、包安装或上一套 CPU 回归历史，尤其在 hosted runner 上还可能包含宿主调度信息；它能在当前 A/B 已空闲时继续超过每核 `0.9`，把真实有效的 official/injected 组全部标为 invalid。提高阈值或无限等待都不符合规格。
- 最小修复：在每个真实 App probe 前后读取逐核 CPU time，以该样本自身区间的 busy delta 归一到 `0..1`，继续使用原 `0.9` 上限；非单调、缺核或不可计算值仍为 invalid。该修改不改变性能预算、样本次数、顺序、重采样上限或产品代码。

## 21. Controls-only 缺少动态 thread 的独立 layout 边界

- Case：`PERFORMANCE-CPU-004`、`PROMPT-CONTEXT-ANCHOR-001`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`38f02309e4091d822ab8d640f13571b7c46a90f5`。
- Red：GitHub run `33107416952` 的 Controls-only 软件渲染组件回归在两种相反顺序中均得到 stream renderer fail；同 revision 的 Wallpaper-only 与完整模块 stream renderer 均通过。定向测试在只增加合同断言、尚未修改 renderer 时因缺少 `.thread-scroll-container` containment 精确失败。
- 预期失败：Controls-only stream renderer p50 为 `49.24%`、official 为 `46.79%`，超过 +2 个百分点预算；layout p50 为 `2513.05ms`、official 为 `2199.20ms`。Control host 自身虽已 containment，但 CSS anchor 仍位于动态 thread 的外层布局域；完整模块只因 Wallpaper 恰好建立该边界而 Green，说明 Prompt/Context 独立模块错误依赖了另一个可关闭模块。
- 最小修复：Prompt/Context 的静态样式自行在既有 `.thread-scroll-container` 建立 `layout paint` containment，与 Wallpaper 开关解耦；保留原生 CSS anchor、body-level 单 host、官方滚动与 flex 几何，不增加 size containment、transform、DOM、listener、observer、timer、worker、controller 或重试，CPU 预算保持原值。软件 renderer 定向 Green 中 input/stream 的 main/renderer 与两种顺序全部通过，stream renderer p50 为 injected `34.24%`、official `37.89%`，一次完成无重试。

## 22. 滚动计时混入 CDP 传输抖动

- Case：`PERFORMANCE-SCROLL-003`、`TDD-INVALID-SAMPLE-019`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`38f02309e4091d822ab8d640f13571b7c46a90f5`。
- Red：本机完整 run `performance-36c95a78-f27f-4eb8-97fe-3792cd091782` 的首轮 scroll fail、第二轮 pass，repeatability 得到 `repeat-conclusion-flip`；定向测试在只改变计时合同后同时命中旧 `scrollStart` 字段和 dispatch 前额外 CDP `evaluate`。
- 预期失败：失败轮 4 个 injected run 的 scroll p95 为 `18.4/17.9/21.8/17.3ms`，official 为 `16.0/18.3/16.1/17.1ms`；单个 `21.8ms` 使四点外层 p95 退化为 max 并超过原预算，但同 run 的 scroll CPU main/renderer、两个顺序组与第二轮 interaction 全部 Green。输入从 DOM `beforeinput` 开始计时，旧滚动却在 CDP 端先写 `performance.now()`、再跨一次协议发送 wheel，错误把不可归属产品的传输间隔计入 renderer latency。
- 最小修复：保留相同 animation-frame 对齐、wheel 距离/节奏、样本数量、p95/max 预算和零重试合同，只把 scroll 起点移到真实 renderer `scroll` 事件，与输入的事件到下一绘制口径一致，并删除 dispatch 前的额外 CDP 往返；不丢弃尖峰、不修改阈值或基线。两轮定向 Green 各池化 80 个 official 与 80 个 injected scroll 事件，双方 p95 均为 `0.10ms`、全局 max 均为 `0.20ms`。

## 23. 两层 p95 在四个 run 上退化成单点 max

- Case：`PERFORMANCE-INPUT-002`、`PERFORMANCE-SCROLL-003`、`PERFORMANCE-INVALID-BASELINE-005`、`TDD-INVALID-SAMPLE-019`。
- Parent revision：`38f02309e4091d822ab8d640f13571b7c46a90f5`。
- Red：修正 scroll 事件计时后的两轮真实 interaction A/B 中，首轮 input fail、第二轮 pass；首轮只有一个 injected benchmark p95 为 `12ms`，其余 injected 为 `9.2/9.6/9.5ms`，但旧聚合仍把 `12ms` 当作全体 p95。定向单测构造相同的 per-run summary 与完整事件数组，旧实现返回 fail，而事件总体 p95 按原预算应 pass。
- 预期失败：每个 renderer benchmark 已先对 20–40 个事件计算一次 p95，旧评估器再对每种模式仅 4 个 run p95 取 p95；nearest-rank 在 4 点上必然选择最大值，把单个 run 的尾部放大成整体结论翻转。这既不是规格要求的“重复足够样本”总体 p95，也会让 input/scroll 的相同产品状态在相邻两轮得出相反结论。
- 最小修复：renderer 只额外保留有界的纯数字 input/scroll latency 数组；评估器按 `included` 和 official/injected 分组后池化所有事件，只计算一次真实 p95，并对同一总体保留全局 max。任何记录缺数组、少于 5 个事件、含负值或非有限值都成为 invalid；A/B 顺序、预热、样本数量、max、p95 公式、性能预算和重采样上限均不改变。两轮定向 Green 各池化 144 个 official 与 144 个 injected input 事件，p95 分别为 `9.4→9.9ms`、`9.2→9.7ms`，三项预算与 repeatability 全部通过。

## 24. CPU 相反顺序组结论翻转被误当作稳定产品结论

- Case：`PERFORMANCE-CPU-004`、`PERFORMANCE-INVALID-BASELINE-005`、`TDD-INVALID-SAMPLE-019`。
- Parent revision：`828b06fe858f8a637fb68f25e88ed2f6b09d38cd`。
- Red：GitHub run `33110393827` 的完整软件渲染 A/B，以及 `node --test test/regression-app-cpu-performance.test.mjs`。CI 的 combined stream renderer 两个相反顺序组分别为 pass/fail，旧评估器仍用四个 run 的聚合中位数输出稳定产品 fail；同 revision 的 Controls-only、Wallpaper-only 均为两组稳定 pass，本机同软件渲染参数再次执行 combined stream 也得到两组稳定 pass（renderer p50 injected `25.87%`、official `34.59%`）。
- 预期失败：当 O-I-I-O 与 I-O-O-I 对同一受预算约束的 main/renderer 得出相反结论时，当前 attempt 无法区分顺序/宿主抖动与产品效果；旧实现只把 `mixed` 留作诊断，导致同 revision、同预算、同 workload 因一次不稳定 aggregate 被错误定性，同时上传摘要不说明 invalid 原因。
- 最小修复：任何受约束 kind 的相反顺序结论翻转均以稳定 reason code `cpu-stability-<phase>-<kind>` 标为 invalid，并沿用原有最多两次 attempt 的有界噪声重采样；两个顺序组稳定失败仍立即 fail 且绝不重试。预算、workload、segment 长度、采样顺序、产品代码和外部负载上限均不改变；allowlisted 摘要记录 invalid attempt reason，raw evidence 继续保留完整样本。

## 25. Control host 的横向 CSS anchor 与滚动容器放大流式布局成本

- Case：`PERFORMANCE-CPU-004`、`PROMPT-CONTEXT-ANCHOR-001`、`TDD-REAL-BOUNDARY-006`、`TDD-INVALID-SAMPLE-019`。
- Parent revision：`0d0c9550c6f8c0a686c83b7254af0525f21bbca4`。
- Red：GitHub run `33113726299` 的 Controls-only 软件渲染 A/B，以及本机相同组件回归。CI 的 stream renderer 在两个相反顺序组均失败，p50 为 injected `44.54%`、official `41.86%`；本机复现为 injected `37.94%`、official `34.81%`，同时结论为 mixed。定向合同测试在产品仍使用横向 `left: calc(anchor(right) + 5px)`、`overflow: hidden` 且缺少 style containment 时精确失败。
- 预期失败：Control host 已由安装/resize/navigation 路径根据 Permissions rect 写入横坐标，CSS 又持续求解相同的横向 anchor；`overflow: hidden` 还把固定控件创建成无意义的 scroll container。动态 thread 增长时，这两项与 host 内部样式失效共同增加 software renderer 的 layout/paint 成本。组件脚本只允许一次 attempt，遇到两个顺序组结论翻转时也无法使用规格已有的唯一一次 invalid 重采样。
- 最小修复：横坐标只保留既有的有界手工定位，CSS anchor 只负责多行 composer 所需的纵向跟随；唯一 host 使用 `contain: layout style paint` 和非滚动容器语义的 `overflow: clip`。浏览器夹具执行同一横向定位后继续验证纵向 anchor 随 Permissions 移动，L3 20 个场景与 L4 七阶段均 Green。Controls-only 软件渲染一次完成且两个顺序组稳定通过：stream renderer p50 为 injected `36.14%`、official `36.24%`，p95 为 `43.68%`、`43.99%`；input renderer p50 为 `16.50%`、`16.29%`，p95 为 `20.15%`、`20.02%`。组件脚本与完整回归一致，最多只对 invalid 重采样一次；稳定 fail 仍立即停止，预算、workload、样本和产品功能均不改变。

## 26. Prompt 与 Wallpaper 重复声明动态 thread 边界

- Case：`PERFORMANCE-CPU-004`、`PROMPT-CONTEXT-ANCHOR-001`、`WALLPAPER-ZERO-HOTPATH-004`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`cd0ed6505edc61f3e1a5de6fe22d957083127b4d`。
- Red：GitHub run `33120095301` 的完整软件渲染 A/B；同 revision 的 Controls-only 和 Wallpaper-only 均稳定通过，但启用两者的完整组合在两个相反顺序组中都得到 stream renderer fail。定向合同测试先要求组合态只有一份 thread containment 且动态内容具备 style 边界，在修改生产 CSS 前精确失败。
- 预期失败：完整组合的 stream renderer p50 为 injected `39.33%`、official `37.28%`，p95 为 `56.21%`、`49.11%`，layout p50 为 `1882.29ms`、`1623.35ms`。Prompt 与 Wallpaper 分别对同一个 `.thread-scroll-container` 激活相同 layout/paint 声明，动态节点增长还可把 style invalidation 传播到透明 Wallpaper 和跨树 CSS anchor；单模块门禁因此无法暴露叠加边界。
- 最小修复：Prompt 只在 Wallpaper 未激活时提供独立 thread containment；Wallpaper 激活后由自己的作用域规则唯一接管。两条互斥路径都使用 `contain: layout style paint`，浏览器计算值为不含 size containment 的 `content`，因此不改变 flex、scrollHeight 或消息尺寸。GitHub run `33121818304` 中 Controls-only、Wallpaper-only 和完整组合均一次稳定通过；完整组合 stream renderer p50 为 injected `35.72%`、official `35.47%`，p95 为 `48.70%`、`44.76%`，两个顺序组均 pass；interaction startup/input/scroll、四个 CPU phase、L3 与 L4 同时 Green。实现不增加 DOM、listener、observer、timer、worker、transform、controller 或重试，预算和 workload 保持原值。

## 27. Linux 实际包工作区路由被 fallback 覆盖

- Case：`PLATFORM-LINUX-WORKSPACE-ROUTE-004`。
- Parent revision：`69bb1b5c672d0a2b7273249136c5a1e924e7d673`。
- Red：`node --test test/regression-linux-platform-runtime.test.mjs test/platform.test.mjs`；前者证明 L5 仍传裸绝对路径，后者证明启动规划器会在显式项目路由后追加 `codex://launch`。
- 预期失败：官方 Linux 打包版只把 `--open-project <path>` 解析为 `newThread` 路由，裸路径仅在 Windows 兼容分支生效；其启动队列又以最后一个路由为准，因此追加的 `codex://launch` 会覆盖项目路由。真实包进程、单一 app-server、Remote 和 loopback CDP 全部正常，但 renderer 永远停在无 composer/sidebar 的空壳页面。
- 最小修复：L5 driver 使用官方 `--open-project` 参数；启动规划器仅在调用方没有显式项目或 Codex deep-link 路由时追加 Linux fallback。隔离 profile、loopback CDP、一次性注入、预算、cleanup 和生产默认启动均保持不变。

## 28. 测试 fixture 在进程退出前删除临时目录

- Case：`TDD-FIXTURE-DRAIN-025`。
- Parent revision：`848cfe7cbdcb2f39f3ee9a0fc3c719a21146d6da`。
- Red：`npm run test:fast`；`Remote-safe reuse` 的业务断言通过后，after hook 以 `ENOTEMPTY` 删除失败，精确归属的 fixture Desktop 仍在临时目录中运行并写入 `desktop.log`。
- 预期失败：fixture 分开注册目录删除和进程停止，清理顺序允许删除先发生；固定等待 80ms 也没有验证 PID/start time/command 对应进程是否真正退出。这会造成测试挂起、残留 App 和偶发假绿/假红。
- 最小修复：单一 after hook 先用正式的精确进程终止边界等待所有 fixture Desktop 退出，确认失败时显式报 PID，再删除该 fixture 唯一拥有的临时目录；不扩大匹配范围、不增加重试，也不触碰用户主 App。

## 29. Linux 实际包探针把可选终端面板误作输入区底部

- Case：`PLATFORM-LINUX-RENDERER-SURFACE-005`。
- Parent revision：`848cfe7cbdcb2f39f3ee9a0fc3c719a21146d6da`。
- Red：`node --test test/regression-platform-renderer-probe.test.mjs test/regression-codex-profile-fixture.test.mjs`；最新版实际包已有 composer、Sessions、主内容和两个唯一注入控件，但旧判定仍因不可见的 `bottom-panel` 与未溢出的 18 条 Sessions 返回 false。
- 预期失败：最新版官方 App 的 `data-app-shell-focus-area="bottom-panel"` 是按需出现的终端/输出面板，并非 composer 下方的视觉底面；把它作为交互前提会让正常线程页等待到超时。只检查单个所谓 bottom 节点还会漏掉其祖先覆盖层中的纯黑背景，而 18 条合成记录不足以保证 820px 窗口的 Sessions 列表真实溢出，滚动性能因此可能被跳过。
- 最小修复：结构就绪只要求可见 composer root、主区、dock 侧栏及其真实 overflow 容器；底部视觉独立采样主区最后 24px 并逐层拒绝纯黑或不透明覆盖；L5 fixture 固定生成 36 条自有 Sessions，实际溢出继续是功能与性能门禁。可选终端面板只保留脱敏诊断，不放宽底部透明、滚动样本、预算或 cleanup 契约。

## 30. macOS 同 bundle 隔离实例创建窗口但停留在离屏状态

- Case：`PLATFORM-MACOS-INTERACTIVE-ACTIVATION-006`。
- Parent revision：`078bc42c0fcfe92b7c2a6bdb4271a11a657cc3bd`。
- Red：`node --test test/regression-macos-native-probe.test.mjs` 先证明缺少精确 PID 的 WindowServer 证据仍会被旧 evaluator 误判为 pass；随后本机 actual official L5 在保护用户主 App PID 55654 时返回测试 PID 10785、一个 1280×820 的 WindowServer 窗口、`onScreenCount=0`、激活失败且没有 Accessibility 窗口。
- 预期失败：`open -g -n -W` 会明确要求后台启动并等待 opener，与真实交互契约冲突；仅删除等待或增加超时仍无法证明同 bundle 的第二实例已位于屏幕上。旧 probe 只看 AX 和截图，无法区分“App 没建窗口”与“macOS 因同 bundle 主实例仍在工作而保留离屏窗口”。
- 最小修复：隔离启动改用官方 Demo launcher 同形的前台 `open -n` 参数，原生 probe 先绑定精确拥有 PID 请求激活，再从 WindowServer 枚举该 PID 的 layer-0 窗口并分别要求真实窗口与 on-screen 状态；截图可发现离屏窗口但通过仍必须满足 on-screen、AX、可恢复输入/滚动和截图全部门禁。实际主 App 冲突继续明确返回未验证且不触碰主实例，不以延长 deadline 或操作用户窗口伪造 Green。

## 31. L4 子进程与父进程使用了不同的 readiness deadline

- Case：`TDD-BOUNDED-DEADLINE-018`。
- Parent revision：`7b1e8aa6a46bc33d4ba2d83a538d28525a2a9a7e`。
- Red：`node --test test/regression-electron-runtime.test.mjs`；新增静态连线合同要求父进程等待 ready 文件时显式传入与子进程相同的 `deadlineMs`，旧实现精确失败，因为子进程可等待 60 秒而父进程仍在 `waitForJson` 的隐式 10 秒默认值处提前退出。
- 预期失败：软件渲染 CI 的完整 L4 启动可能合法超过 10 秒，但旧父进程会先报 `app-sequence-failed`，子进程随后才完成，造成确定性期限名义一致、实际不一致。增加 retry 或只扩大隐式默认值会继续保留双重真相，并掩盖阶段归属。
- 最小修复：父进程的唯一 readiness 等待显式复用已经校验过的 `deadlineMs`；不新增 retry、轮次或宽松预算。修复后同一工作树连续两轮完整 Electron official/injected/recovery 序列 Green，所有阶段仍由单一共享上限约束。

## 32. 最新实际包的 Sessions 与 Composer 外层结构未被旧选择器识别

- Case：`PLATFORM-LINUX-RENDERER-SURFACE-005`。
- Parent revision：`7b1e8aa6a46bc33d4ba2d83a538d28525a2a9a7e`。
- Red：`node --test test/regression-sidebar-scroll.test.mjs test/wallpaper-lite.test.mjs`；实际 Linux L5 已显示侧栏候选为 661px 高但 `scrollHeight === clientHeight`，同时最新版输入区使用 `[data-codex-composer-root]`，旧代码分别选择最大外壳并只绘制 legacy Composer selector。两个新增合同在生产修改前分别精确失败。
- 预期失败：外层侧栏虽声明 `overflow-y` 却不承载 Sessions 内容，按高度排序会跳过真正溢出的内层 viewport，使滚动 workload 和功能门禁都误报；输入编辑器本身透明且不是壁纸绘制边界，把它当 Composer 会把正常的最新版外层误报为未着色。
- 最小修复：探针与 renderer benchmark 共用一个纯函数，优先选择实际 `scrollHeight - clientHeight > 1` 且溢出量最大的候选，无溢出时才按高度确定回退；静态 Wallpaper CSS、社区安全 CSS 映射与视觉探针同时纳入 `[data-codex-composer-root]`。诊断只增加候选数和尺寸，不读取会话文本，不增加 DOM、listener、observer、timer、worker 或 controller。

## 33. Prompt-only 缺少 Composer paint 边界使纵向 anchor 参与流式布局

- Case：`PERFORMANCE-CPU-004`、`PROMPT-CONTEXT-ANCHOR-001`、`TDD-REAL-BOUNDARY-006`。
- Parent revision：`2d7c96841ec9c1d8bf194f6096e1b66da70e6900`。
- Red：本机 clean Controls-only 回归 `performance-component-controls-e01ff216-17c7-4f58-a567-9688c71a31f6` 两次 attempt 均为 `cpu-stability-stream-renderer` invalid；反向顺序 injected renderer p50 `36.46%`、official `33.31%`，layout p50 分别为 `1660.77ms`、`1502.52ms`。先尝试完全删除 CSS anchor 时，`npm run test:browser` 精确以控件 top `2px` 而非 Permissions `120px` Red，证明不能拿位置回归换性能。
- 预期失败：Wallpaper 激活时 Composer 已有独立 paint containment，因此同 revision 两轮完整组合性能均稳定通过；仅 Prompt/Context 激活时缺少这层边界，纵向原生 anchor 的布局依赖可跨入动态消息更新。删除 anchor 会破坏多行 Composer、resize 和 Session 替换时的原生对齐，不符合功能规格。
- 最小修复：保留纵向 CSS anchor、body-level host 和现有一次性横坐标，只在 Wallpaper 未激活时给 legacy、`data-codex-composer` 与最新版 root 互斥补上 `contain: paint`；真实 Chrome 计算样式必须为 `paint`。候选的 20 个 L3、L4 七阶段和 Controls-only 一次双顺序均 Green，stream renderer p50 为 injected `36.38%`、official `36.19%`，不新增 JS、DOM、listener、observer、timer、worker 或重复 containment。

## 34. Linux injected 在 Sessions 异步目录加载完成前结束 readiness

- Case：`PLATFORM-LINUX-RENDERER-SURFACE-005`。
- Parent revision：`2d7c96841ec9c1d8bf194f6096e1b66da70e6900`。
- Red：GitHub run `33130065334` 的 actual Linux L5；同一个 36-thread 隔离 profile 中 official 已得到 `scrollHeight=1237`、recovery 得到 `927`，但 injected 在 1.7 秒 controls ready 时只得到 `clientHeight=scrollHeight=661` 并报 `sessions-not-scrollable`。定向 readiness 合同在旧条件仍返回 true 时精确失败。
- 预期失败：App 的 composer、manager 和控件可先于 Sessions 目录异步完成；只等 `interactive && controlsReady` 会把加载中的非溢出外壳交给最终视觉门，造成同一 profile 的时序假红，并跳过 injected benchmark/CPU。放宽“Sessions 必须真实滚动”断言会让功能和滚动性能假绿。
- 最小修复：唯一的 15 秒有界 renderer readiness 同时要求已找到且真实溢出的 Sessions viewport，再采最终截图并进入 benchmark；不增加 retry、固定 sleep、监听器或门禁豁免，超时仍明确 unverified。

## 35. 平台 CPU 把诊断 helper 总量当产品预算且未重采 invalid

- Case：`PERFORMANCE-CPU-004`、`PERFORMANCE-INVALID-BASELINE-005`、`TDD-INVALID-SAMPLE-019`。
- Parent revision：`2d7c96841ec9c1d8bf194f6096e1b66da70e6900`。
- Red：GitHub run `33130065334` 的 actual Linux L5 中 official idle/scroll 因临时进程身份变化成为 `invalid-sample`，旧 L5 未执行规格允许的唯一一次重采样；定向 evaluator 还证明即使 main/renderer 完全在预算内，只把诊断用 `other/total` 提高也会使旧平台预算失败。
- 预期失败：规格约束的是 main 与 renderer 各自的 +2/+5 个百分点，GPU、utility 与 helper 只用于诊断；用 total 比较会把软件渲染 helper 和进程生命周期噪声误算为注入回归。invalid 是无效证据而非产品 fail，必须最多重采一次，耗尽后仍不得 pass。
- 最小修复：平台 evaluator 对每个 phase 分别生成 main/renderer 两个未放宽的 CPU 预算，继续保留 other/total 原始诊断；每段只在 sampler 返回 invalid 时有界重采一次并记录 attempt reason，pass 不重采、产品预算 fail 在汇总阶段直接失败。定向测试同时证明 helper 总量不影响受约束 kind、invalid→pass 只执行两次且 invalid 耗尽仍不通过。

## 36. 平台门禁把官方自身 long task 误算为 codexctl 新增

- Case：`PERFORMANCE-INPUT-002`、`PERFORMANCE-CPU-004`。
- Parent revision：`bb966986e968f297596947c2d17e1d8ad20ba9d6`。
- Red：GitHub run `33130065334` 的 actual Linux L5 中 official benchmark 已观测到 4 个 50ms 以上 long task，recovery 也有 1 个；旧 evaluator 遍历三个 run 并要求每个计数都为 0，因此即使 injected 没有增加任何 long task 也必然产品 fail。新增确定性测试让 official/injected/recovery 具有相同 baseline 计数，在生产修改前精确得到 `fail !== pass`，其余 5 个用例保持 Green。
- 预期失败：规格约束的是“由 codexctl 新增”的 long task，而非要求最新版官方 App 在软件渲染环境下绝对为零。把 official 或 clean recovery 的既有事件归因给 codexctl 会在相同 workload 的官方基线变慢时制造假红；反过来只检查 injected 是否为零也无法使用同机基线控制环境噪声。
- 最小修复：benchmark 与每个非 idle CPU workload 都以 official/recovery 观测上界作为既有基线，只在 injected 计数超过该基线时输出稳定的 `run-1-*-long-task`；缺失、负数或非整数计数继续使整份证据不完整。新增超过基线仍稳定 Red，预算、阈值、采样时长、workload 和 retry 均不改变。

## Green 绑定规则

- 每项定向测试、邻近层和 `npm run test:fast` 必须 Green。
- Renderer/App 边界还必须通过 L3/L4，macOS/Linux 声明还必须通过对应 actual L5。
- 最终 `summary.json` 为每个 case 记录 status、层级、平台、evidence、dirty 和 revision；只有与待交付 revision 完全一致的 clean 结果才是 Green 证据。
- 预算值和规格断言没有为修复调宽；临时 provider、bottom、anchor、Remote、预算和 cleanup 故障均已证明门禁会 Red。
