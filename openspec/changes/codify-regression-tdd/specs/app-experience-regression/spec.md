## Purpose

本能力把 codexctl 对 Codex/ChatGPT App 的核心用户体验定义为可重复执行的回归契约，确保启动、Remote、一次性注入、视觉、Prompt/Context、性能、恢复和跨平台行为在交付前都有真实边界证据。

## ADDED Requirements

### Requirement: 配置默认值与用户状态连续性
回归套件 SHALL 验证 codexctl 使用官方 provider 和目标 App 内置 CLI，且普通主实例启动不会改写官方 `config.toml`、全局 shell 环境、登录身份、生产 user-data-dir 或历史会话归属。Prompt 的默认 profile MUST 为 `default`，Context 的默认模式 MUST 为 `native`。

#### Scenario: 全新 codexctl 配置使用正确默认值
- **WHEN** 在没有 codexctl 用户覆盖项的隔离配置中生成 runtime
- **THEN** Prompt 选择为 `default`，Context 选择为 `native`，启动计划使用官方 provider 和目标 App 的内置 CLI

#### Scenario: 项目代理保持局部且无凭据
- **WHEN** 项目 YAML 声明允许的无凭据代理并创建一次 App 启动计划
- **THEN** 代理只存在于该次启动事务，官方 `config.toml`、shell 配置、launchd/systemd 和持久 runtime 均不包含代理凭据或 provider 改写

#### Scenario: 未知 provider 不由 codexctl 注入
- **WHEN** 启动前后的官方 `config.toml` 被比较
- **THEN** codexctl 不得新增 `crs` 或其他非官方 provider；若输入文件原本无效，命令以可操作错误终止且保留原文件，不得静默覆盖

#### Scenario: 主实例保持历史会话身份
- **WHEN** 对生产主实例执行官方启动或显式注入启动
- **THEN** 启动计划继续使用同一官方用户目录和账户身份，不得因临时测试 profile、relay 或 CLI 版本漂移导致历史 Sessions 被隐藏

### Requirement: Official 启动、单实例与 Remote 等价
回归套件 SHALL 证明 `codexctl app` 的进程身份、内置 CLI、Remote 状态和官方图标启动等价，并证明 `codexctl app --inject` 在增加所选模块后仍保持相同 Remote 协议兼容性。同一 App bundle 和用户身份 MUST 只有一个有效 primary/app-server 所有者。

#### Scenario: Official 启动等价于图标启动
- **WHEN** 同一 App 构建分别由图标基线和 `codexctl app` 启动
- **THEN** 两者均通过平台官方启动通道、使用 App 内置 CLI、无调试参数和注入环境，Remote 最终进入 connected

#### Scenario: 注入启动保持 Remote 可连接
- **WHEN** 通过 `codexctl app --inject` 完成一次性注入
- **THEN** Remote 在规定超时内进入 connected，日志不存在 WebSocket reset、server already online、协议版本不匹配或重复 presence

#### Scenario: 替换旧实例时排空完整后代树
- **WHEN** 受管 primary 被 official 或 injected 新实例替换
- **THEN** 旧 primary、app-server、renderer 和 modifier monitor 在新 app-server 接管前全部退出，且进程身份检查确认没有第二个有效实例

#### Scenario: 未知并行实例安全失败
- **WHEN** 发现无法证明归属的同 bundle 进程
- **THEN** codexctl 拒绝终止或覆盖该进程，报告精确冲突信息并且不启动可能造成双实例的新 primary

### Requirement: 一次性注入是原子完整进程事务
显式注入 SHALL 先完成所有非破坏性准备，再跨完整 App 进程边界安装不可变 runtime。安装成功后 controller MUST 退出，稳态不得存在 codexctl watcher、supervisor、Prompt/Context worker、Wallpaper worker、调试 socket 或健康轮询。项目 YAML、CLI 默认值、主题资源和注入模块目录等静态输入不得被监听并热改正在工作的 renderer；已安装控件通过 App 官方请求边界操作当前 thread 不属于静态 runtime 热改。

#### Scenario: 成功注入后无常驻控制器
- **WHEN** 注入回执确认精确 App PID、runtime revision 和模块 revision
- **THEN** 启动监听或 loopback CDP 连接被关闭，controller 在有限时间内退出，进程扫描中只剩 App 自身允许的进程

#### Scenario: 静态注入配置变更延迟到下次完整启动
- **WHEN** 用户在 App 运行期间通过项目 YAML 或 CLI 修改 Wallpaper 主题、Prompt profile catalog、Context preset catalog、模块开关或其默认值
- **THEN** 当前 renderer 不被监听或热修改，新静态配置只在下一次显式 `app --inject` 完整启动时生效；App 内已安装的 Prompt/Context 菜单仍分别遵循本规格定义的运行期行为

#### Scenario: 重复注入不累积状态
- **WHEN** 对同一配置连续执行两次完整注入
- **THEN** 第二次使用新进程和单一最新 revision，DOM host、style、listener、timer、preload hook、CDP 连接和后台进程数量不得累积

#### Scenario: macOS preload 在启动导航后仍有界完成
- **WHEN** macOS App 冷启动、恢复窗口或用户切换 Session 导致主 renderer 在一次性安装期间导航，且旧文档中的 `executeJavaScript` 尚未返回
- **THEN** preload SHALL 立即废弃旧文档的安装代次，在下一次主文档 DOM ready 后只重装最新代次；CLI 的完整事务 deadline MUST 覆盖 hook 自身声明的最坏有界阶段，不能用与内层阶段冲突的固定 15 秒提前杀掉仍合法运行的安装
- **AND** 成功回执仍须绑定最终 App PID、renderer URL 和所有启用模块 revision；真正超时时一次失败并报告最后阶段、导航次数和耗时，不得通过无限重试、常驻 watcher 或后台 supervisor 掩盖

#### Scenario: 半安装失败回退到干净官方实例
- **WHEN** runtime 校验、App 启动、模块安装或回执验证中的任一步骤失败
- **THEN** 失败实例被精确关闭；若已跨替换边界则启动无注入、无 relay、无调试参数的官方实例，并清除本事务拥有的临时资源

### Requirement: Wallpaper 完整视觉与零稳态开销
Wallpaper 回归 SHALL 同时验证结构样式、真实 computed style、真实隔离 App 截图和 diagnostics。壁纸 MUST 覆盖完整 viewport，包括 Sessions/sidebar、main、header、composer 周边和可见 bottom panel；非主题有意设计的官方不透明黑底不得遮住壁纸。稳态 observer、timer 和 layout read MUST 全为 0。

#### Scenario: 首次可交互时壁纸及时可见
- **WHEN** 注入 App 的目标 renderer 到达 DOM ready
- **THEN** root active 属性、匹配 revision 的 style 和有效 Blob URL 在 750ms 内完成，截图可见壁纸而不是纯黑占位

#### Scenario: Bottom panel 不再露出黑底
- **WHEN** 主内容高度不足、内容可滚动、composer 多行展开和窗口缩放四种状态分别渲染
- **THEN** bottom panel 及其直接 surface 的 computed background 保持透明，壁纸覆盖到 viewport 最底部且没有横向或纵向黑带

#### Scenario: Sidebar 与内容区保持主题语义
- **WHEN** 使用包含 sidebarOpacity、composerOpacity、overlay 和 focal point 的主题
- **THEN** 实际渲染值与主题配置一致，Sessions 可读、主内容可读，系统不得私自提高不透明度下限或把 Sidebar 变成纯黑

#### Scenario: 桌面 Sessions 侧栏展开时推开主内容
- **WHEN** 目标 App 处于官方基线判定为持久侧栏的桌面 viewport，且 Sessions 侧栏从收起变为展开
- **THEN** 注入版 SHALL 保留官方 shell 的 docked 几何关系，Sidebar 右边界不得越过 Main 左边界，Main 的可用宽度随侧栏展开而减少且内容保持可交互；Wallpaper 不得把持久侧栏改成 floating/absolute overlay，也不得用提高不透明度掩盖重叠
- **AND** 只有官方基线在相同 App 版本、viewport 和侧栏状态下明确使用 floating variant 时才允许覆盖式侧栏，注入版不得自行改变该断点或布局模式

#### Scenario: Wallpaper 稳态不响应输入和滚动
- **WHEN** 连续产生 1000 组输入事件、100 次 Sessions 滚动和流式消息 DOM 变化
- **THEN** Wallpaper diagnostics 的 observer、timer、layoutReads、reconcile 和 DOM mutation 计数不增长，且不存在 blur、filter、固定背景或持续动画

### Requirement: Prompt 与 Context 行为和位置一致
Prompt/Context 回归 SHALL 验证控件、菜单、请求转换、历史 thread 语义和 diagnostics。控件 MUST 位于 React root 外且只存在一份，并通过浏览器原生定位能力跟随 composer；普通输入、滚动和流式输出不得触发布局扫描或 UI reconciliation。

#### Scenario: 控件随 composer 扩展而定位正确
- **WHEN** composer 从单行扩展到多行、窗口缩放并切换 Sessions
- **THEN** Dev 与 Context 控件继续与 Permissions 控件对齐、可点击、未遮挡、未重复，位置更新不依赖 input/scroll listener、MutationObserver、ResizeObserver 或轮询

#### Scenario: Prompt 默认值和当前 thread 保持明确
- **WHEN** 没有显式 Prompt 覆盖的新 task 被创建
- **THEN** 使用 `default` profile；恢复没有新 override 的历史 thread 时保留其 rollout instructions，不得误写为其他 profile

#### Scenario: Developer Prompt 的 Next Base 只消费一次
- **WHEN** 用户在历史 thread 选择 `Next Base` 后继续当前 thread、恢复另一个历史 thread，再创建一个新 task
- **THEN** 两个历史 thread 均不被改写，只有紧接着创建的新 task 使用所选 base，选择在消费后恢复默认策略

#### Scenario: Context 文案不继承 Prompt one-shot 语义
- **WHEN** 当前 thread 已建立且用户打开 Context 菜单或选择 `native`、preset 或 custom Context
- **THEN** Context 控件不得显示“只对下一个 task 生效”或 `Next Base`；只有 Developer Prompt 的 `Next Base` 可以使用该 one-shot 语义

#### Scenario: 高频导航和输入不增加后台工作
- **WHEN** 连续切换 100 次 Sessions 并产生 1000 组输入事件
- **THEN** 活动导航修复 timer 不超过 3，结束后 navigation/toast/bridge timer 全为 0，manager 深层发现最多一次，输入前后的 ensureSchedules 和 positionPasses 不增长

### Requirement: Context 是当前 thread 的可变实时控制
当前 thread 已建立时，Context 菜单 SHALL 控制该 thread，而不是只设置新 task 默认值。系统 MUST 以当前已应用的配置容量作为比较下限：明确 preset 比较 `model_context_window`，双方均有明确 compact 阈值时还 MUST 保证目标阈值不降低；已经完成 resume 但等待 fresh usage 的目标也计入当前已应用容量。`native` MUST 先按当前 App、model 和 provider 解析为可比较的官方容量，不能把空 override 当作不可热切换。只有同档或增大的目标可以修改当前 thread；缩小、无法可靠比较或不满足 token 安全条件的目标 MUST 在任何 unsubscribe/resume 之前失败并保持原配置。

“立即生效” MUST 指目标在下一次尚未发出的模型请求之前应用：空闲 thread 立即执行；已有回复正在生成时不得中断或追溯修改该请求，而应在本轮完成后的第一个安全请求边界应用，并阻止下一请求抢先使用旧 Context。排队和验证 MUST 由现有请求生命周期事件驱动，不得新增 observer、轮询或常驻 worker。

#### Scenario: Native Context 不覆盖官方字段
- **WHEN** Context 为 `native` 并发起 thread start 或 resume 请求
- **THEN** codexctl 不写 model context window、auto compact limit 或伪造 token usage 字段

#### Scenario: 空闲 thread 同档或增大立即生效
- **WHEN** 当前 thread 空闲且用户选择与当前已应用容量相同或更大的明确 Context
- **THEN** 系统立即通过当前 thread 的安全 resume 路径应用目标配置，按钮显示目标配置值并进入 fresh usage 验证状态；用户无需创建新 task 或重新注入 App

#### Scenario: 正在生成时在当前 thread 的安全边界生效
- **WHEN** 当前回复正在生成且用户选择任意合法 Context
- **THEN** 当前回复继续完成，系统仅保留一个事件驱动的切换意图并在本轮结束后、下一次模型请求发出前应用；UI 显示“本轮完成后应用到当前 task”而不是“只对下一个 task 生效”

#### Scenario: 连续选择只应用最后一个合法目标
- **WHEN** 当前回复生成期间用户连续选择多个合法 Context
- **THEN** 系统合并未执行意图并只应用最后一个目标，不创建多个 resume、timer、observer 或后台任务

#### Scenario: 缩小 Context 并在需要时标记下轮 compact
- **WHEN** 目标配置窗口或 compact 阈值小于当前已应用值
- **THEN** 空闲 task 立即通过官方 resume 事务缩小，active task 在下一次模型请求前应用；当前 token 已越过新阈值时保留历史并明确标记下一轮先自动 compact

#### Scenario: Native 参与相同的容量判定
- **WHEN** 用户为当前 thread 选择 `native` 且当前 App、model、provider 的官方容量已可靠解析为与当前相同或更大
- **THEN** 系统在相同安全边界 resume 当前 thread，请求不携带 window/compact override，并以 fresh 官方 token usage 验证结果；不得因目标名为 Native 而强制推迟到新 task

#### Scenario: Native 容量无法可靠解析
- **WHEN** 系统无法为当前 App、model、provider 获得可信的 Native 可比较容量
- **THEN** 当前 thread 保持不变且不发送变更请求，UI 显示无法确认原因；已解析且更小的 Native 仍按普通缩容规则应用

#### Scenario: 选择当前 Context 是幂等操作
- **WHEN** 用户再次选择当前已经应用且语义相同的 Context
- **THEN** 系统报告当前 task 已处于该 Context，不执行 unsubscribe、resume、持久状态重写或新的验证任务

#### Scenario: 272K 和 450K 映射准确
- **WHEN** 从真实 Context 菜单分别选择 272K 和 450K，并捕获 start/resume 请求及下一条 fresh token usage
- **THEN** 请求保留各自配置窗口与 compact 字段，258.4K 只确认 272K，427.5K 只确认 450K，258.4K MUST NOT 被显示或接受为 450K

#### Scenario: 热切换期间展示区分配置值与有效值
- **WHEN** 当前 thread 从一个 Context 档位切换到另一个档位且旧 token usage 仍被复用
- **THEN** 按钮继续显示配置档位，title/subtitle 显示 pending 或匹配的新有效窗口，旧 usage 不得确认或拒绝；只有下一条 fresh usage 可以确认目标，若不匹配则恢复上一份已确认的 thread Context 并报告失败

### Requirement: 交互性能必须接近官方基线
性能回归 SHALL 在同一机器、同一 App 构建、等价隔离 profile 和固定工作负载下交替运行 official 与 injected；丢弃一次预热后至少完成两组 A/B。套件 MUST 报告启动、输入、Sessions 滚动、long task、CPU、脚本/样式/布局时长以及 renderer diagnostics，且使用相对基线和绝对噪声容限共同判定。

#### Scenario: 注入不显著延迟可交互
- **WHEN** 汇总至少两组有效 official/injected 冷启动与暖启动样本
- **THEN** injected 的 launch-to-interactive 中位数不超过 official 中位数加 750ms，模块从 DOM ready 到完整可见的 p95 不超过 750ms

#### Scenario: 打字延迟保持丝滑
- **WHEN** 在真实 composer 逐字符输入固定文本并重复足够样本
- **THEN** injected p95 不超过 `max(official p95 × 1.15, official p95 + 2ms)`，injected max 不超过 official max 加 16ms，并且没有由 codexctl 新增的 50ms 以上 long task

#### Scenario: Sessions 滚动延迟保持丝滑
- **WHEN** 在真实可滚动 Sessions 列表执行固定距离和节奏的滚动序列
- **THEN** injected p95 不超过 `max(official p95 × 1.15, official p95 + 2ms)`，injected max 不超过 official max 加 16ms，scrollTop 结果和官方基线一致

#### Scenario: 稳态 CPU 与任务数量无回归
- **WHEN** App 空闲 30 秒并分别执行输入、滚动和流式内容压力段
- **THEN** injected 相对 official 的 renderer/main CPU 中位数增量不超过 2 个百分点、p95 增量不超过 5 个百分点，controller CPU 为 0 因其已退出，observer/timer/worker 数量满足各模块零稳态合同

#### Scenario: 基线噪声使结果无效
- **WHEN** official 样本存在 Remote 重连、系统高负载、不同 App 版本、不同 profile 数据或指标离群超出预设稳定性界限
- **THEN** 本组结果标为 invalid 并重新采样，不得把无效基线当作 injected 通过或失败的证据

### Requirement: 恢复必须跨完整进程边界
回归套件 SHALL 验证关闭注入或执行 clean 后，通过完整 App 重启恢复官方状态。删除 DOM/style/global 的热 cleanup 只能用于测试回滚，MUST NOT 被当作性能恢复完成的证据。

#### Scenario: Clean 后恢复官方状态
- **WHEN** 已注入实例执行 clean 或切换到 `codexctl app`
- **THEN** 原 App 及完整后代树退出，新实例无 renderer globals、注入 style/button、preload/CDP 参数和 codexctl 后台进程，Remote 正常 connected

#### Scenario: 热撤销后仍卡不被误判修复
- **WHEN** 同一 renderer 中移除注入节点后性能指标仍异常
- **THEN** 测试明确要求关闭整个 App 进程并重新建立 official 基线，不得增加常驻 DOM 监控来掩盖残留 heap、framework 或 compositor 状态

#### Scenario: 清理只作用于精确归属资源
- **WHEN** 测试结束并清理临时 profile、进程、socket 和文件
- **THEN** 每个目标均通过 PID、start time、command、profile 路径和事务记录验证，未知资源以及用户正在工作的主 App 保持不动

### Requirement: macOS 与 Linux 平台契约分别验收
回归发布结果 SHALL 分别声明 macOS 和 Linux 的实际执行状态，不能用合成 DOM 或另一平台的通过结果代替目标平台。缺少目标平台时结果 MUST 为 unverified，而不是 pass。

#### Scenario: macOS 使用官方进程身份
- **WHEN** 在受支持 macOS App 上执行 official 和 injected 回归
- **THEN** 两者均由 LaunchServices 零参数启动且无 remote-debugging flag，injected 使用一次性 preload 回执，内置 CLI 与 App 协议版本一致
- **AND** 本次测试拥有的精确 PID 必须具有可激活、位于屏幕上的 WindowServer/Accessibility 窗口后才可执行交互；若同 bundle 的用户主 App 正在工作，测试不得读取、点击、关闭或替换主实例，也不得把离屏测试窗口或延长等待伪报为通过

#### Scenario: Linux 使用受限一次性连接
- **WHEN** 在受支持 Linux Codex/ChatGPT 发行包上执行 injected 回归
- **THEN** 应用发现识别真实包名和可执行文件，CDP 只绑定 loopback、只连接匹配 `app://` target、注入完成即关闭，且 Remote/历史状态不因临时测试参数被持久化

#### Scenario: Linux 实际包进入隔离工作区
- **WHEN** L5 在真实 Linux 发行包上启动 official、injected 和 recovery 隔离实例
- **THEN** 启动参数使用发行包支持的显式项目路由进入本次测试拥有的工作区，fallback 不得覆盖该路由，三个实例均显示可交互 composer、Sessions 和主工作区后才允许继续视觉与性能验收

#### Scenario: 缺少平台执行环境
- **WHEN** 发布候选没有在某个声明支持的平台运行真实 App 回归
- **THEN** 该平台显示为 unverified 并阻止宣称“全平台回归通过”，报告列出缺少的环境和待执行命令
