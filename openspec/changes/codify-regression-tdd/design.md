## Context

仓库当前使用 Node ESM 与内置 `node:test`，已有 `npm test`、`npm run check`、真实 headless Chrome 回归和 renderer benchmark。底层事务、renderer payload 与性能不变量已有较多测试，但它们以文件和实现职责组织，缺少从用户场景到测试层级、平台证据和发布结论的统一映射。详见 [proposal.md](proposal.md)；行为边界由两份 delta spec 定义。

关键约束：产品注入必须保持一次性、Remote-safe 和零常驻控制器；macOS 生产路径不能为了测试打开 DevTools；测试不能操作用户正在工作的主 App；所有文本文件不超过 400 行；实现优先使用 Node/OS 现有能力，避免把测试框架依赖带入产品 runtime。

## Goals / Non-Goals

**Goals:**

- 让每个核心用户场景都能从稳定 case ID 追踪到可执行测试、平台和证据。
- 提供快速反馈与真实 App 证据并存的五层门禁，失败能定位到具体边界。
- 用同版本 official/injected A/B 和统一预算消除“凭感觉判断性能”的争议。
- 让测试运行安全、可重复、可清理，并产出不含隐私的审计结果。
- 把 Red/Green/Refactor 变成可检查流程，而不是文档口号。
- 将 Context 当前-thread 同档/增大切换固化为可测试的请求边界状态机，同时保持零常驻监控。

**Non-Goals:**

- 不在测试 runner 内增加生产 watcher、observer、supervisor 或远程调试入口。
- 不用完整截图像素一致性锁死第三方 App 的所有视觉细节。
- 不把用户主 App、真实会话正文或登录凭据复制成测试夹具。
- 不重新设计 Wallpaper、Developer Prompt、Remote 或 CLI 的其他用户语义；Context 当前-thread 非缩容切换及错误文案是本 change 明确修正的行为边界，其他产品偏差按最小修复处理。
- 不用单个平台结果推断另一个平台已通过。

## Decisions

### 1. 以可执行 Case Catalog 作为单一回归索引

建立一个只含数据和小型校验函数的 regression catalog。每个条目包含稳定 ID、capability/requirement、测试层级、适用平台、执行入口、超时、预算、证据类型以及是否阻断交付。测试源码以同一 ID 注册，静态检查验证 ID 唯一、测试存在、必选场景不为空、没有孤立核心测试。

Catalog 不复制 spec 全文，只承担“规格场景到执行证据”的映射；OpenSpec 仍是行为真相来源。条目按 config、launch-remote、injection-lifecycle、wallpaper、prompt-context、performance、recovery 和 platform 小文件拆分，聚合器仅导出只读列表，从结构上保持每文件低于 400 行。

备选方案是维护一份 Markdown checklist，但它无法检测测试被删除或只在文档中宣称覆盖；另一方案是把所有元数据塞进测试名，解析脆弱且难表达平台和预算，因此不采用。

### 2. 五层门禁共享场景，不追求一个巨型 E2E

测试流如下：

```text
OpenSpec scenario -> Case Catalog
                  -> L1 pure/unit contract
                  -> L2 process/transaction integration
                  -> L3 real Chromium semantics
                  -> L4 isolated App official/injected A/B
                  -> L5 target-platform release evidence
                                      -> summary.json + summary.md
```

- L1 复用 `node:test` 验证纯转换、校验和默认值。
- L2 使用临时目录、fake desktop 和真实子进程验证事务、失败回退与归属清理。
- L3 扩展当前 headless Chrome runner，加载真实 payload，验证 CSS anchor、computed style、DOM 唯一性和事件/计数预算。
- L4 启动两个等价隔离 profile，交替测 official 与 injected 的真实 Remote、视觉、输入、Sessions 滚动、CPU 和进程状态。
- L5 在 macOS/Linux 目标发行包上执行平台适配器和恢复流程，并保存平台签名证据。

快速层按每次编辑运行，真实 App 层按影响范围和交付前运行。拆层能给出快速 Red，同时避免一个昂贵、脆弱、无法定位失败的端到端脚本。

### 3. 一个轻量 Orchestrator，多个职责单一的 Probe

新增的顶层 regression 命令只负责选择 case、创建 run directory、调用层级 runner、合并结果和决定总状态。具体工作拆成独立 probe：环境/版本快照、进程归属、Remote 状态、视觉语义、交互性能、残留扫描和结果脱敏。每个 probe 返回结构化值，不直接决定全局 pass。

现有 `browser-regression.mjs` 与 `benchmark-renderer.mjs` 被复用或拆出公共只读模块，不另写第二套 CDP、计时或 target 发现逻辑。产品模块不得导入测试 runner；测试可以导入纯生产函数，但 App 探测必须穿过真实进程边界。

顶层命令计划为：

- `npm run test:fast`：静态检查、L1、L2 和适用的 L3；
- `npm run test:app`：L4 隔离 App A/B；
- `npm run test:platform`：当前平台 L5；
- `npm run test:regression`：根据 catalog 执行本机所有必选层并汇总，任何 unverified 不得显示为全平台 pass。

保留现有 `npm test`、`npm run check` 和 `npm run test:browser` 作为稳定入口，避免一次迁移破坏日常使用。

### 4. Context 热切换采用单调容量与请求边界状态机

Context 切换资格由纯逻辑先判定，再进入带回滚的请求事务。当前比较下限来自 thread 已确认记录或已经成功 resume、等待 fresh usage 的目标记录，不能被 resume 后重放的旧 token usage 降低。明确 preset 比较配置窗口，双方 compact 阈值均明确时同时比较阈值；Native 从当前 App/model/provider 的可信官方能力解析为同一尺度，不能用 `null` 直接绕过比较或判成 next-task-only。

状态转换固定为：

```text
confirmed -> queued-at-safe-boundary -> applying
          -> awaiting-fresh-usage -> confirmed | rollback
```

空闲 thread 从 `confirmed` 直接进入 `applying`。回复正在生成时只在现有请求生命周期上保存一个最新合法意图；本轮结束事件触发应用，下一次模型请求必须等待应用完成。连续选择通过替换该单一意图合并，不建立 timer、observer、worker 或第二套生命周期。小于当前容量、compact 阈值倒退、token 用量不安全或 Native 容量未知的目标在任何 unsubscribe/resume 前失败。

应用事务复用 App 官方的 thread read/unsubscribe/resume 边界。Native 请求不得写 window/compact override，但仍必须作用于当前 thread 并由下一条 fresh 官方 usage 证明；旧 usage 只维持 pending。resume、状态竞争或 fresh usage 验证失败时恢复先前订阅和已确认 Context，UI 只在恢复成功后报告失败。相同语义选择为纯幂等，不发请求。

备选方案一是维持 Native 只能用于新 task，但这把实现限制伪装成产品语义且违背数字档位已有的热切换能力；备选方案二是运行期轮询 task 状态，但会重新制造输入、滚动和 CPU 回归。因此采用现有请求事件驱动的有界状态机。

### 5. 性能采用交替 A/B、双重容差和统一预算文件

同一 run 固定源码、App/CLI 版本、窗口尺寸、profile fixture、工作负载和采样器，按 O-I-I-O 或 I-O-O-I 交替执行；第一次仅预热，至少保留两组有效 A/B。先验证 official 样本稳定性，再套用 spec 中的相对公式和绝对噪声容限。预算集中在版本化数据文件，case 只能引用预算 key，禁止各脚本硬编码不同阈值。

采样器记录 raw samples 而非只记录均值：launch-to-interactive、DOM-ready-to-visible、input/scroll p50/p95/max、long tasks、CPU、script/style/layout duration、observer/timer/worker 和 diagnostics。输入/滚动统一在 animation-frame 边界派发；stream 固定 12 秒且限制 live DOM 数量，避免随样本位置持续爬坡。CPU 中位数使用完整 segment 归一化均值的标准中位数，p95 保留原始区间分布；main 与 renderer 分别套用预算，GPU/helper/total 只保留诊断证据。CPU 也必须完成 O-I-I-O 与反向 I-O-O-I 两组，组结论保留为顺序敏感性诊断，最终由四个 official 与四个 injected 样本的聚合 p50/p95 判定。系统高负载、身份/Remote 异常或无效指标才标记 invalid 并最多重新采样一次；稳定产品 fail 不重试。总判定重点是 p95、max 与新增长任务；无效基线单独标记 invalid，限定重新采样次数。

仅使用绝对阈值会因机器差异产生假失败，仅使用相对阈值会让本来很慢的 official 掩盖问题；双重容差兼顾二者。预算变更必须独立修改规格和评审，不能与让测试“变绿”的产品修复同提交。

### 6. macOS 与 Linux 使用不同驱动但同一指标模型

Linux/明确允许 DevTools 的隔离模式继续使用受限 loopback CDP，连接完成即关闭。macOS official/preload 路径保持零参数 LaunchServices，不增加 remote-debugging flag；真实交互由仅测试使用的原生 Accessibility probe 按目标 PID 定位 composer 与 Sessions，各采集 20 个可恢复输入/滚动延迟样本。CPU 段由同一 probe 执行可恢复的 input、scroll 和 content-growth 工作负载，系统采样器只统计登记 App 进程树；窗口截图提供视觉证据。

两个驱动输出相同的标准结果结构，因此预算与报告不依赖平台实现。macOS Accessibility/Screen Recording 权限在启动任何 App 前预检；缺少权限返回 unverified 并列出精确权限，不回退到操作生产窗口或偷偷打开 DevTools。

备选方案是在 macOS production App 打开 CDP 以复用 Linux benchmark，但这会改变进程身份和 Remote 行为，测到的不是要交付的路径，因此拒绝。

### 7. 视觉回归采用三角证据而非脆弱全图 Golden

视觉 case 同时使用三类证据：L1 静态 payload/选择器契约，L3 真实 Chromium computed style 与几何关系，L4/L5 隔离 App 的结构 diagnostics、区域截图和语义检测。Wallpaper 检查 viewport/bottom/sidebar/main/composer 的透明度、背景图存在、有效覆盖和对比度；在官方基线为持久侧栏的相同 App 版本、viewport 和展开状态下，还比较 Sidebar/Main bounds 与 Main 可用宽度，要求 Sidebar 右边界不越过 Main 左边界且展开确实推开 Main。floating variant 只按官方相同断点接受，注入样式不得修改 position、inset、transform、display、width 或父级 flex/grid 来制造覆盖，也不得用更深底色掩盖几何重叠。Prompt/Context 检查唯一性、bounds、anchor 跟随和菜单可达。

截图会保存供审阅，但自动判定聚焦稳定区域和语义不变量，避免第三方字体抗锯齿、文案或小版本布局变化让整张 golden 无意义失败。App 结构真正变化导致 selector 或区域无法识别时必须失败并更新契约，不能用 document-wide observer 自愈。

### 8. 所有 App 测试先建立 Ownership Envelope

Runner 在启动前创建唯一 run ID、临时根、profile、runtime、动态端口和进程登记簿。任何 kill、cleanup 或 UI 操作前重新校验 PID、start time、command、bundle、profile 和 parent chain；生产 user-data-dir、未知进程和未登记资源硬拒绝。

进程等待使用可观察事件和有界 deadline，不使用任意长 sleep。异常和信号处理只清理 envelope 内资源，最后独立扫描 orphan、socket、profile 和 codexctl worker。用户主 App 验证是单独的显式交互模式，默认永远关闭；即使检测到主 App 已关闭，自动门禁也只使用自己启动的隔离实例。

macOS preload 另外使用一次性安装代次状态机。每次主文档 DOM ready 创建新代次；主 frame 或 in-page 导航会使正在执行的旧代次失效，即使旧 `executeJavaScript` Promise 随后完成也不能写成功回执。下一次 DOM ready 只启动一个最新代次，最终回执绑定该代次的 PID、URL 与模块 revision。hook 的总 deadline、单阶段上限和父事务等待预算来自同一只读预算模块，父预算严格覆盖 hook 最坏路径及有限文件交接余量；失败包含最后阶段、导航次数和耗时。该状态机成功或失败后对称释放 DOM/navigation listener 与 deadline timer，不进入稳态，也不以扩大固定超时替代导航中止逻辑。

### 9. TDD 证据与最终回归证据分开记录

每个缺陷 case 的 Red 记录包含 parent revision、单 case 命令、失败断言和最小复现；Green 记录绑定最终 revision。Runner 不尝试修改 Git 历史，但会拒绝缺少有效 Red 元数据的新 defect case。纯重构标记为 characterization，不伪造 Red。

每次完整 run 写入忽略版本控制的 `test-results/regression/<run-id>/`，包含经 schema 校验的 `summary.json`、简洁 `summary.md`、原始性能数据、脱敏日志和必要截图。结果记录 dirty 状态，源码变化后旧结果自动失效。敏感字段采用 allowlist 输出，不依赖事后正则猜测；Prompt、会话正文、token、环境全量和用户路径不进入结果。

### 10. 采用增量迁移，不一次重写现有测试

先建立 catalog/schema/runner，再为现有测试补 case 映射并填补缺口。任何阶段都保持原测试命令可用；新增门禁只有在自身经过故意失败验证、异常清理验证和两次稳定重复后才升级为 required。旧文档清单随后改为链接 catalog 生成摘要，避免双重维护。

新发现的产品 bug 必须先进入 catalog 和最小层级测试，再写修复；如果 L4 暴露 L1 无法复现的问题，保留 L4 Red，同时提取纯逻辑用例加速迭代，但不能删除真实边界用例。

## Risks / Trade-offs

- [第三方 App 更新会改变 DOM/Accessibility 结构] → 使用语义定位、版本快照和 fail-closed 诊断；更新适配器时保留对应 App 版本证据。
- [真实 App、Remote 和系统负载带来噪声] → 交替 A/B、预热、基线稳定性检查、raw sample、有限 invalid 重采样；绝不默认 retry 产品失败。
- [macOS 权限在 CI 或新机器缺失] → 运行前 preflight，明确 unverified；配置具备权限的专用 runner，不降低为合成通过。
- [完整门禁耗时增加] → 快速层用于日常 TDD，L4/L5 按影响范围和交付运行；catalog 保证没有因为分层而漏掉必选证据。
- [截图或日志泄露用户数据] → 仅使用隔离 fixture、区域截图、字段 allowlist 和结果 schema；发现敏感字段立即失败并删除本 run 结果。
- [测试基础设施自身变复杂] → runner 只编排，小 probe 单一职责，复用 Node/现有脚本和 OS 能力，同样受 320/400 行拆分门禁和故障注入测试。
- [严格预算初期暴露当前实现不达标] → 将失败视为真实基线，不先放宽；按 case 分批修复，直到最终 revision 满足规格。

## Migration Plan

1. 建立 catalog、预算、结果 schema、临时目录与 ownership envelope，并用故意失败/中断测试验证门禁本身。
2. 映射现有 L1/L2 测试，补齐配置默认值、provider 隔离、single-instance、Remote、注入回退和恢复缺口。
3. 将现有 Chrome 回归纳入 L3，先以 Red 用例锁定 Context 同档/增大、Native、缩容拒绝和请求边界状态机，再补齐 Wallpaper 全区域、Prompt/Context anchor、菜单和无热路径工作断言。
4. 实现 L4 平台驱动和 A/B sampler，先以非阻断模式收集两轮稳定基线，再锁定 spec 已定义预算。
5. 在 macOS/Linux 专用环境执行 L5，完善权限 preflight、结果脱敏和异常清理；平台均真实通过后启用发布阻断。
6. 更新现有测试文档和发布流程，只从 catalog 生成覆盖摘要；对最终 revision 完整重跑并保存结果。

回滚时可以暂时撤下顶层 required gate，但保留已经证明有效的回归 case、结果 schema和现有测试入口；本 change 不改变用户数据格式或产品配置，因此没有产品数据迁移和回滚步骤。
