# 测试与回归验收

## 单一覆盖索引

所有 OpenSpec Scenario 与补充质量门禁都在机器可读 catalog 中维护。生成的
[回归 Case Catalog](REGRESSION_CATALOG.md) 是审阅入口，列出场景与补充门禁的层级、平台、预算和公开执行命令；不要在本文复制一份容易漂移的功能清单。

更新 catalog 后运行：

```bash
npm run catalog
npm run check
```

`npm run check` 会拒绝过期目录、重复或孤立 case、缺少测试/执行器、未知预算、`.skip`/`.only`、循环依赖、敏感内容、机器绝对路径和超过 400 行的文本文件。

## 五层门禁

| 层级 | 边界 | 命令 | 完成条件 |
| --- | --- | --- | --- |
| L1 | 纯函数、schema、预算、状态机 | `npm test` | 全部通过，0 skip/todo |
| L2 | 文件、进程、事务、失败回退 | `npm run test:fast` | 所有资源精确清理 |
| L3 | 真实 headless Chromium renderer | `npm run test:browser` | 视觉、请求与热路径计数全绿 |
| L4 | 隔离 Electron App official/injected A/B | `npm run test:app` | 功能、视觉、Remote、恢复与故障门禁全绿 |
| L5 | 真实 macOS/Linux 发行 App | `npm run test:platform` | 目标平台实际证据绑定当前 revision |

GitHub Ubuntu 的 L4 fixture 在 `xvfb` 下显式使用无沙箱的软件渲染参数，避免托管
runner 缺少可用 GPU sandbox 后把基础设施故障误报成产品回归。该开关只存在于隔离
测试进程；本机 L4、macOS L5 与产品 App 启动参数保持不变。

完整汇总：

```bash
npm run test:regression
```

每个入口都支持 `--help`；支持场景选择的入口可使用 `--case CASE-ID`。未知 case 必须在启动浏览器或 App 前失败。

日常快速反馈：

```bash
npm run check
npm test
npm run test:browser
npm run test:fast
```

`test:regression` 的 `--quick` 只缩短性能样本，不会把缺少的 L4/L5 证据伪装成 pass。`fail`、`unverified`、`blocked`、`invalid` 或 cleanup failure 中任意一种都会阻止总体 pass。

发送恢复的 L3 fixture 使用真实 Chromium 帧序，覆盖短暂隐藏、无 resize 恢复、修复 timer 结束后的整体替换。测试控制通道仅连接本次临时 profile 启动的 Chrome、精确匹配本次 `file://` fixture；生产 `app://` CDP 目标校验保持不变。

控件允许按宽度折叠。L4 必须实际打开 More，确认被折叠项目可见可点；不能把隐藏按钮的零宽度误判为功能缺失。L4 同时记录活动 observer 总数与通过 DOM 目标核验的局部数量：二者必须相等且至多为 2，官方/仅壁纸模式必须为 0。输入与流式输出的扫描、UI 重建和额外 timer 仍为零，CPU/延迟预算不放宽。

## Ownership Envelope

所有浏览器与 App runner 在启动前创建唯一 run ID、临时 root/profile/runtime、动态 loopback port 和进程登记簿。任何关闭或清理动作都要再次匹配 PID、start time、command、profile 和 parent chain。

自动测试始终遵守以下边界：

- 不注入、点击、读取、滚动、关闭或替换用户正在工作的主 App；
- 不使用生产 user-data-dir，不复制会话正文或 Prompt 正文到结果；
- 不终止未知同 bundle 进程；
- 只删除本 run 的临时目录、socket 和已登记进程；
- SIGINT、SIGTERM、子进程异常和 deadline 走同一个有界 cleanup；
- 测试结束后独立扫描 orphan、controller、worker 和 crash handler。

主 App 的最终人工确认只在开发者 L1–L5 全部通过后请求，并且是额外验收，不替代自动回归。

## macOS preload 与 L5

生产 `codexctl app` 和 `codexctl app --inject` 都通过 LaunchServices；official 路径没有注入环境，preload 路径不开放 DevTools。LaunchServices 环境通过显式 `open --env` 传递，避免 GUI 启动丢失 `NODE_OPTIONS`、spec 或 result 路径后出现固定超时。

preload lifecycle 与父事务使用同一个只读模块提供共享有界预算。父 deadline 覆盖所有有限 hook 阶段和文件交接余量；导航会废弃旧安装代次并在最终文档只安装最新代次。真正失败必须报告最后阶段、导航次数和耗时，成功或失败后 listener/timer 都归零。不得恢复冲突的固定 15 秒父超时，也不得以 retry、watcher 或 supervisor 掩盖问题。

macOS L5 使用后台 force-new 隔离实例和 macOS 原生 Accessibility probe，按已登记 PID 验证：

- App/内置 CLI 版本与进程身份；
- official/injected Remote 与单一 app-server；
- preload 回执和模块 revision；
- composer 输入与 Sessions 滚动各 20 个原生延迟样本，并逐次恢复原值；
- official→injected→official 的启动、输入、滚动统一预算；
- 30 秒 idle 及固定 input/scroll/content-growth 段的真实进程树 CPU；
- window/control bounds 与区域截图权限；
- 完整重启恢复和零残留。

Accessibility 或 Screen Recording 权限缺失时结果必须是明确的 `unverified`，不能退化为读取用户主窗口或偷偷开启 CDP。

## Linux L5

Linux runner 必须使用实际 ChatGPT/Codex 发行包。应用发现接受真实包名差异，但 CDP 只允许动态 loopback endpoint，只连接匹配的 `app://` page target，安装完成即关闭 socket。

Linux L5 还要证明 Remote、真实视觉/交互预算、单一 app-server、临时 HOME/profile 无持久修改和零残留。runner 通过发行包内置 CLI 在 run envelope 中建立无服务权限的离线 shell 凭据，并通过真实 `app-server` 创建 18 个合成 Sessions；每个 thread 只写入一条固定测试标题并立即 interrupt，从 `thread/list` 证明已持久化，不具备成功调用模型服务的凭据。发行包启动时只接收 run envelope 根目录这个 positional project，使首次 shell 与合成 Sessions 使用同一隔离 workspace，避免误停在 workspace chooser。主分支 CI 若配置 `OPENAI_API_KEY` secret，会在 fixture 完成后才通过 stdin 写入该临时 `CODEX_HOME`；两种凭据都不进入 argv、日志、artifact 或 App 环境。缺少 display、发行包或目标 renderer 时必须输出 `unverified`；L3/L4 fixture 不能替代实际发行包。

平台证据写入：

```text
regression-results/platform-evidence/<revision>/macos.json
regression-results/platform-evidence/<revision>/linux.json
```

平台矩阵只有在两份 actual 结果均为 pass、`dirty=false` 且 revision 完全相同时才是全平台 pass。

## Renderer 功能与视觉

L3/L4 使用同一真实 payload 验证以下不变量：

- Wallpaper 在 750ms 内覆盖 root、viewport、Sidebar、Main、Composer 和 bottom panel；
- short/long content、多行 composer、resize 下没有底部黑带；
- docked Sessions Sidebar 参与官方 shell 布局并推开 Main，不覆盖中间内容；
- 只有官方相同断点的 floating variant 可以浮层；
- Wallpaper observer/timer/layout read/reconcile/mutation 全为 0；
- Prompt/Context host 位于 React root 外且各一份，按实际原生几何跟随 composer；
- 1000 组输入与 100 次导航不增加 ensure/position 工作，导航 timer 峰值不超过 3 且最终为 0。

Context 请求测试必须区分配置窗口与 95% effective window：272K→258.4K，450K→427.5K。258.4K 绝不能确认 450K。空闲增大或缩小均立即作用于当前 task；active 只排队最后一个合法目标并在下一请求前应用；越过新 compact 阈值的缩容要标记下一轮自动 compact，未知 Native 仍在 unsubscribe/resume 前零请求拒绝。Context 不得显示 Prompt 专属的“只对下一个 task 生效”。

## 性能 A/B

性能 runner 固定 App/CLI 版本、profile fixture、viewport 和 workload，丢弃一次预热，按 O-I-I-O / I-O-O-I 交替采样，至少保留两组有效 official/injected A/B。stream 段固定 12 秒并限制 live DOM 数量；CPU 中位数比较完整 segment 的均值，p95 仍来自该 segment 的原始区间样本。默认不重试产品失败；仅噪声样本可在有限次数内重新采样，耗尽后为 `invalid`。

统一预算来自 `regression/budgets.mjs`：

- launch median：injected ≤ official +750ms；DOM-ready-to-visible p95 ≤750ms；
- input/scroll p95：≤ `max(official ×1.15, official +2ms)`；
- input/scroll max：≤ official +16ms；
- renderer/main CPU median：≤ official +2 个百分点，p95 ≤ official +5 个百分点；
- codexctl 新增 ≥50ms long task：0；
- controller CPU：0，因为 controller 已退出。

性能结果必须保留 raw samples、基线有效性、script/style/layout duration、observer/timer/worker、系统 CPU、App 外部 CPU 和 cleanup。Linux 进程 CPU 从 `/proc/<pid>/stat` 读取 tick 并按 `CLK_TCK` 归一化，禁止用只有整数秒精度的 `ps TIME` 采样 500ms 区间；macOS 保留带小数的 `ps` 采样。main 与 renderer 分别对 O-I-I-O 和反向 I-O-O-I 两组的四个 official/四个 injected 样本执行聚合预算；同一 CPU attempt 的两个相反顺序组若对任一受约束 kind 得出相反结论，则证据为 `invalid` 并记录 `cpu-stability-<phase>-<kind>`，最多重采样一次。两个顺序组都稳定失败时仍为产品 `fail`，不得重试；GPU/helper/total 只用于诊断。上传摘要只暴露 max/p50/p95 聚合值和稳定 reason code，早期 runner 异常也必须原子发布最小 `summary.json`。外部 CPU p95 超过每核 90 个百分点时样本同样为 `invalid` 并最多重采样一次，不能崩溃、误判产品或重试稳定产品 fail；fixture deadline 必须覆盖完整采样段。修改预算需要独立规格决策，不能与产品修复混合来“调绿”。

## 故障与恢复

核心门禁会临时破坏 provider 字节保护、bottom transparency、control anchor、Remote receipt、性能预算和 cleanup，逐项证明对应测试确实 Red；撤销故障后必须再次 Green。

正确恢复跨完整进程边界：

1. 验证 injected 实例；
2. 关闭精确归属的完整后代树；
3. 启动干净 official 实例；
4. 验证无 renderer globals/style/button、preload/CDP/worker；
5. 验证 Remote connected 且只有一个 app-server；
6. 再运行 official 输入/滚动基线；
7. 验证 profile、socket 和进程零残留。

同一 renderer 热删除节点后仍卡，不能算恢复成功，也不能通过新增 DOM 监控掩盖残留 heap、framework 或 compositor 状态。

## 结果与交付

完整结果位于忽略版本控制的 `regression-results/<run-id>/`，包含 allowlist schema 校验的 `summary.json`、`summary.md`、suite evidence、raw metrics 和脱敏截图索引。结果不得包含 token、完整环境、Prompt/会话正文或机器绝对路径。

最终 revision 的固定顺序：

```bash
npm run check
npm test
npm run test:browser
npm run test:fast
npm run test:app
npm run test:performance
npm run test:platform
npm run test:regression
openspec validate codify-regression-tdd --strict
```

任何源码变化都会使旧 revision/dirty 证据失效。完整 SOP 见 [CODE_SOP.md](CODE_SOP.md)，架构边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。
