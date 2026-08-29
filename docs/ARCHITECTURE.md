# 架构

## 核心原则

`codexctl` 把一次 App 启动视为原子事务。默认路径优先保证官方 Remote：

```text
codexctl app             -> LaunchServices / official -> Remote-safe
codexctl app --inject    -> immutable runtime -> full process boundary
                         -> macOS LaunchServices preload / Linux loopback CDP
                         -> one-shot modules -> exact receipt -> controller exits
```

配置命令只提交 config 与对应 runtime，不热改当前 renderer。`app --inject` 完整替换并注入；`app` 把受管注入实例完整替换为官方状态。即使 DOM cleanup 看似成功，当前进程也不会被重新标记为“干净官方”，因为 JS heap、框架对象、样式与 compositor 缓存无法由局部清理证明已恢复。

## Runtime generation

`src/runtime.mjs` 在私有 staging 目录完成以下工作：

- 解析和校验 Prompt profile；
- 合并 Context preset；
- 加载、校验并物化 Wallpaper；
- 编译两个 renderer payload；
- 计算配置、引擎和资源 fingerprint；
- 写入 manifest 后原子 rename；
- 最后才更新 current pointer。

任一步失败都会删除 staging，旧配置与已提交 generation 保持可用。引擎 revision 包含所有 renderer fragment、注入器、主题加载器与验证模块，代码更新不会误复用旧 payload。

## App transaction

`src/app-transaction.mjs` 负责唯一的进程切换边界：

1. 发现 macOS `.app` 或 Linux package/launcher；
2. 按 `codexctl.yaml` 选择 Remote-safe official 或显式注入/relay；
3. 在终止旧实例前完成所有非破坏性准备；
4. 快照旧主进程的完整后代树，主进程退出后按 PID、start time、command 精确排空残留；
5. 只替换精确受管的 primary App，未知实例 fail closed；
6. macOS official 与显式注入均用 LaunchServices 零参数启动，注入不启用 DevTools；
7. relay 模式先验证 bridge handshake；
8. macOS 验证绑定 PID/revision 的 preload 回执；Linux/隔离模式运行一次性 CDP 注入器；
9. 写入包含 PID、start time、connection fingerprint、transport 和 module 状态的 managed record。

注入或握手失败时，新实例会被关闭。如果事务已经跨过 primary replacement boundary，则启动无 CDP、无注入、无 relay 的官方 App 作为回退。

受管 renderer 曾经注入过时，即使目标配置相同，也不会热复用；再次执行 `codexctl app --inject` 会完整重注入，执行 `codexctl app` 会完整恢复官方实例。这是性能恢复合同，不是优化建议。

旧 app-server 必须在新实例启动前退出，否则同一 Remote installation ID 会短暂出现两个服务端连接并触发 “server already online”。旧 modifier monitor 即使与新主进程使用同一 App bundle，也会通过 parent PID 被识别和回收；crashpad 只在整个 bundle 没有主进程时清理。

## macOS 启动期 preload

`src/macos-preload.cjs` 由 LaunchServices 的单次启动请求加载。它不添加 argv，不启动 DevTools，也不附加 debugger；因此进程身份与点击图标一致，官方 Remote WebSocket 不会进入调试实例的 reset 路径。

Hook 严格读取当前不可变 generation 的 spec，立即从 `process.env` 删除 hook 参数，在 primary `app://` 文档 `dom-ready` 时安装模块，并原子写入一次回执。LaunchServices 需要的环境使用显式 `open --env` 传递，避免 GUI 启动吞掉 spec/result 路径。每次主文档导航都会废弃旧安装代次；最终文档只允许最新代次提交回执。

`macos-preload-budget.cjs` 是 hook 阶段与父事务的单一预算来源，父 deadline 覆盖 hook 的最坏有限路径和文件交接余量，不再使用会抢先杀死合法安装的固定 15 秒等待。生命周期、asset 传输和回执校验分别位于小型职责模块。回执绑定 App PID、最终 renderer URL、Prompt/Context revision、Wallpaper revision 与零 observer/timer 合同；没有 composer 的登录/首页文档可返回已安装但 controls dormant 的状态，后续真实导航仍由 renderer 自身的有限 navigation lifecycle 挂载控件。成功或失败后 preload listener/timer 都释放；不创建 watcher、轮询、supervisor 或后台 worker。

## Linux/隔离模式一次性 CDP

`src/renderer-injection.mjs` 是两个模块共用的唯一 CDP 实现。它验证：

- HTTP 与 WebSocket endpoint 都是 loopback；
- target type 是 page；
- target URL 是 `app://`；
- target id 只含允许字符，且与 WebSocket path 一致；
- avatar overlay 在连接前被过滤。

每个 session 只执行安装和 diagnostics，随后关闭 WebSocket。没有 browser-level discovery watcher、Page reload listener 或健康文件刷新。

## Prompt / Context

Prompt/Context renderer 被拆成小型职责片段：

- bootstrap 与状态；
- Developer Prompt one-shot policy；
- thread 记录与请求转换；
- 私有 client 的有界发现；
- Context 资格、映射与请求边界 policy；
- context hot switch；
- 菜单；
- composer 控件样式；
- composer 控件；
- diagnostics 与生命周期。

片段按固定顺序组装后做整体验证。启动时的 manager 搜索有对象数、深度、单片耗时与尝试次数上限。Prompt/Context 控件位于 `document.body` 下、React root 之外的独立 host；composer reconciliation 无权删除它。控件通过 Chromium 原生 CSS anchor 跟随 Permissions 按钮，旧内核保留单次内联坐标回退。UI 不安装全 document subtree/resize observer，只在首次安装及真实导航动作后做有限修复。因此字符输入和流式 token 不会触发 DOM 扫描、定位或重建。

Prompt 与 Context 的 request transform 独立。`Next Base` 通过版本化 claim 只供紧接着的新 task 使用一次，成功后恢复配置默认 profile；失败回滚不能覆盖更新的 task 边界或用户选择，也不会改写当前 rollout。

Context qualification 是 DOM 无关的单调容量判定。空闲 task 的同档/增大目标立即进入带恢复的官方 resume 事务；active task 仅在现有请求生命周期中合并一个最新目标，并由下一模型请求先等待其应用。缩容、compact 倒退、token 不安全和未知 Native 在任何订阅修改前拒绝。`native` 使用每个 thread 的 fresh 官方 usage 解析可比较容量，合法切换不写 model window/compact override；272K/450K 与 258.4K/427.5K 的确认使用同一精确映射。

## Wallpaper

Wallpaper 由三个小模块组成：

- `theme-loader.mjs`：稳定、安全地读取主题；
- `payload.mjs`：编译小型静态 CSS 和 renderer payload；
- `injector.mjs`：分片传输图片、创建 renderer Blob、安装并验证。

图片不嵌入 JavaScript 或 CSS data URL。preload/CDP 都以 192 KiB 分片传输，renderer 创建 Blob URL。最终 payload 通常只有数 KiB。

稳态 diagnostics 必须满足 observer=0、timer=0、layoutReads=0。CSS 禁止 `:has()`，去除 blur/filter 和 fixed background，并冻结持续动画。它只设置 root、sidebar、main 和 composer 的稳定样式，不给 message/token 节点打标。

## 清理

`codexctl clean` 会关闭模块、删除本 controller 的旧自动启动项、停止精确识别的旧 worker、关闭受管隔离实例，并把曾注入的 primary App 完整替换为官方实例。

旧 `auto-inject.mjs` 与 `supervisor.mjs` 只保留“识别和清除历史安装”的兼容代码，不存在启动常驻进程的 API。未知 PID、未知 CDP 实例和其他 controller 的启动项保持不动。

## 连接隔离

macOS official 与 preload 模式都经 LaunchServices 启动且不传 argv。两者都锁定 ChatGPT.app 内置 CLI，禁止从 PATH 换入不同版本，以保持 Remote/Browser 的 app-server 协议和 presence 注册一致。preload 的环境只属于这一次启动请求，hook 读取后立即从 Node 环境删除，子 app-server 不继承；它不写 shell、launchd 或用户配置。Relay 只在单次直接启动的子进程环境中存在；key 通过指定环境变量读取，不进入 argv。Bridge 只在官方 CLI 对匹配 initialize 返回成功后写入短期 handshake，launcher 验证后立即删除。`codexctl.yaml` 允许声明无凭据代理，但硬性禁止持久化环境。

## 代码边界

每个文本文件硬限制 400 行。详见 [CODE_SOP.md](CODE_SOP.md)。`npm run check` 同时验证物理行数、JavaScript 语法、模块循环、Prompt renderer 组装语法、敏感信息、机器绝对路径，以及 catalog/预算/执行器/测试映射。

## 回归架构

OpenSpec 的 68 个 Scenario 加 2 个补充质量门禁由 `regression/catalog/` 映射到 L1–L5 执行器，生成 [REGRESSION_CATALOG.md](REGRESSION_CATALOG.md)。顶层 runner 只负责编排、归属 envelope、状态聚合和 allowlist 结果；视觉、交互、CPU、平台身份、TDD 证据与清理分别由职责单一的 probe 判定。

`summary.json` 的非 pass 状态是封闭集合：fail、unverified、blocked、invalid。平台矩阵要求 macOS/Linux 两份 actual 证据均为 pass、`dirty=false` 且绑定同一最终 revision。测试产物位于忽略版本控制的 `regression-results/`；源码或 dirty 状态变化会使旧证据失效。
