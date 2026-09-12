# Codexctl 代码与性能 SOP

本 SOP 是硬约束。`npm run check` 会执行，违反时禁止交付、提交和发布。

## 1. 文件上限

- 仓库中的文本源文件、脚本、测试和文档最多 400 个物理行，包含空行与注释。
- 不设 vendor、测试、模板或文档例外；超过 400 行必须先重构。
- 禁止用 minify、多语句挤一行、超长行或删除必要说明来规避门禁。
- 二进制图片和归档不按“行”计算，但仍受各自大小及格式校验约束。

达到 320 行时应开始规划拆分，不要等到第 401 行。拆分依据是职责和依赖方向，例如：加载、校验、编译、传输、生命周期分别成文件。共享逻辑只能向下沉淀到小而稳定的模块，禁止循环依赖。

## 2. Renderer 性能预算

默认不允许在 App renderer 内使用以下机制：

- `document.body` 或 `documentElement` 的全子树 `MutationObserver`；
- 常驻 `setInterval`、递归 cadence timer 或轮询；
- 每个字符、token、message 或滚动事件触发 DOM 扫描；
- `:has()` 等会因子树变化反复做祖先失效的选择器；
- wallpaper 面板上的 blur、filter、固定背景和持续动画；
- 未限定深度/对象数/时间片的 React Fiber 或对象图遍历。

确实需要事件监听时，必须满足全部条件：事件与业务动作直接相关；作用域最小；回调不做全树扫描；`cleanup()` 对称移除；诊断信息能证明数量；自动测试覆盖安装和释放。

Wallpaper 的稳态合同是纯静态样式与 Blob：observer=0、timer=0、layout read=0。Prompt/Context 只允许启动时的有界查找，以及真实导航后的有限修复；打字和流式输出不得触发 UI reconciliation。

Prompt/Context 启动必须优先走 memo-cache 快速路径；深层 React 图搜索最多执行一次并在浏览器空闲切片中运行。Sessions 连续导航只能保留最新一组修复任务，活动修复 timer 上限为 3。控件使用实际几何与命中检测，保持原生按钮的属性和尺寸不变。

几何修复最多使用一个 MutationObserver 和一个 ResizeObserver。前者仅递归观察 footer、直接观察其父节点；后者仅观察 composer、footer、原生控件及布局祖先。禁止观察整个对话或全 document 子树。输入/流式内容记录必须直接过滤，不触发扫描或重建；稳态外部点击不重复定位。自动验收必须核对实际 observer 的目标、数量、cleanup 释放，以及 input/stream 前后的工作量，而不能把累计创建数量当成活动数量。Wallpaper 仍严格为零 observer。

Context 必须区分配置窗口和 Codex token usage 上报的有效窗口。当前兼容合同只接受配置原值或精确的 95% 有效值（272K→258.4K、450K→427.5K）；450K 绝不能把 258.4K 判为成功。新 task、历史 resume、当前 task 热切换和 UI 展示必须共用同一匹配函数。

当前 task 的 Context 切换资格必须先由纯函数判定：任意合法档位均可进入事务；缩小 window 或降低 compact 阈值时保留历史，当前 token 已越过新阈值时标记下一轮需要 compact。只有 Native 容量未知等不可判定目标才在任何 read/unsubscribe/resume 前拒绝。回复 active 时只在既有请求生命周期中合并一个最新合法目标，并在下一模型请求前完成应用；不得为排队新增 timer、observer、worker 或轮询。fresh usage 验证失败必须恢复已确认记录。

Developer Prompt 的 `Next Base` 是版本化 one-shot。新 task 请求必须先原子 claim，再恢复配置默认 profile；请求失败只能在 claim 仍是最新 task 边界且用户没有新选择时回滚，不能污染当前或历史 rollout。

## 3. 一次性注入合同

注入唯一受支持入口是显式 `codexctl app --inject`：

1. 校验配置和资源，生成不可变 runtime；
2. 完整启动或完整替换目标 App；
3. macOS 必须使用 LaunchServices 零参数 preload；Linux/隔离模式仅连接 loopback CDP；
4. 一次性安装已开启模块并读取精确 PID/revision diagnostics；
5. 移除 preload 启动监听或关闭 CDP socket，控制器进程退出；
6. 稳态不得留下 watcher、supervisor、worker 或定时健康写入。

项目 YAML、CLI catalog、主题和模块默认值等静态配置修改只落盘，不热改当前 renderer。再次运行 `codexctl app --inject` 才生效；不带参数的 `codexctl app` 专用于 Remote-safe 官方模式。已安装的 App 内 Prompt/Context 控件只通过官方请求边界操作 task，不监听或热加载这些静态输入。

热 `cleanup()` 只能用于低级测试和失败回滚，不能宣称恢复官方性能。renderer 曾经注入过后，恢复合同必须跨完整 App 进程边界，因为 JS heap、样式/合成缓存、私有 client patch 和第三方框架状态不可能由 DOM 删除证明已重置。

注入失败时，必须关闭失败实例并回退到干净官方 App；不允许留下半安装状态。

## 4. 视觉等价门禁

旧版 CDP renderer 的整窗观感是壁纸行为基线。传输通道可以因平台连接约束而变化，但传输重构不得同时删改视觉语义。macOS 继续使用不破坏 Remote 的一次性通道；它投递的壁纸结果必须与基线对齐。

- 壁纸必须覆盖完整 viewport；左侧 Sessions、主内容、header、composer 和可见 bottom panel 不得露出不透明官方黑底。
- 主题中的 `sidebarOpacity`、`composerOpacity`、overlay 和焦点位置必须原值生效；禁止为了“稳妥”私自抬高透明度下限。
- 新版 App 增加或替换 surface token 时，必须扩展静态结构选择器并新增回归测试，不能靠 observer 或轮询补洞。
- 性能重构必须与视觉重构分开提交、分开验收；未经真实界面 A/B，不得以 payload 更小或 CPU 更低宣称完成。
- 活跃主窗口不做热注入验证。所有源码变更仅在用户下一次主动完整启动时生效。

## 5. 变更流程

每次修改按以下顺序执行：

1. 写清可观察结果、失败边界和不变量；
2. 先做只读诊断，记录 PID、renderer、CDP 端口和残留进程；
3. 修改最小职责模块，不顺手扩大权限或连接模式；
4. 运行 `npm run check` 和 `npm test`；
5. 使用隔离 profile 做官方基线与注入版本 A/B；
6. 实测真实 composer 输入、真实左侧会话列表滚动和 long tasks；
7. 验证注入器退出后没有后台进程；
8. 验证关闭模块后通过完整重启回到无 CDP、无注入的官方状态；
9. 验证旧 App 的 app-server、renderer、monitor 子进程已排空，再启动替代实例；
10. 检查 diff、敏感信息、绝对路径与 Git 状态后才能提交。

所有外部行为修复必须遵循 Red → Green → Refactor。Red 需要稳定 case ID、修复前 revision、最小命令和命中用户可见偏差的失败断言；语法错误、损坏夹具和缺少环境不算 Red。纯重构使用前后相同且始终为 Green 的 characterization 测试。不得通过修改预算、删除断言、`.skip`/`.only`、默认 retry 或 mock 假成功完成 Green。

主窗口在活跃对话或流式输出时不是可信基准。性能验收优先使用隔离 App；长对话窗口只作为额外压力测试，不替代可重复的 A/B。

## 6. 性能验收

同一机器、同一 App 构建、同一隔离 profile 条件下至少各跑两次官方和注入版本。记录：

- 启动到一次性注入确认的耗时；
- composer 输入 latency 的 p50、p95、max；
- 左侧会话列表滚动 latency 的 p50、p95、max；
- long task 数量与最长持续时间；
- renderer/main CPU 稳态采样；
- observer、timer、后台 worker 数量；
- wallpaper 可见性、Prompt/Context 控件与请求转换正确性。

验收重点不是平均值，而是 p95、max 和可重复性。出现明显回归、超长任务、残留进程或视觉未加载时，不得以“功能可用”交付。

## 7. 安全与连接

- 不带 `-c` 的启动必须使用官方 provider，显式清理旧 relay/provider 环境变量。
- macOS official 与一次性 preload 注入必须经 LaunchServices 启动，official 保持零参数；`live start` 是唯一允许附加动态 loopback CDP flag 的长会话入口。
- relay 只存在于单次 App 启动，不写入 config、runtime、日志或 Git。
- 项目 YAML 只允许无凭据代理；任何启动环境都只能作用于单次启动请求，preload 参数必须在主进程启动期立即删除，禁止写入 shell、launchd 或 `config.toml`。
- CDP 只绑定并连接 loopback，拒绝非 `app://`、avatar overlay 和不匹配 target id 的 endpoint。
- live 配对或挂载失败只清理 controller 自己的 companion、socket 和记录，不终止仍可使用的 Desktop。
- 只终止 controller 拥有且 PID、启动时间、命令均匹配的进程；未知实例保持不动并报告。
- App 替换必须先快照并排空旧主进程的完整后代树，禁止旧 app-server 与新实例同时使用同一 Remote installation ID。
- 用户 Prompt、Wallpaper 和主题包必须先做路径、类型、大小、稳定读取与内容校验。

## 8. Review 清单

回归目录由 `regression/catalog/` 生成到 [REGRESSION_CATALOG.md](REGRESSION_CATALOG.md)，不能再维护第二份手写 case 清单。五层公开入口为：

```bash
npm run check
npm test
npm run test:browser
npm run test:fast
npm run test:app
npm run test:platform
npm run test:regression
```

L1/L2 不能替代真实 Chromium，L3 不能替代隔离 App，L4 不能替代 macOS/Linux 实际发行包。缺少平台、权限、登录或连接条件必须为 `unverified` 并阻止全平台 pass。结果只有在 `dirty=false` 且绑定最终 revision 时有效；用户人工确认是额外验收。

- [ ] 每个文本文件不超过 400 行；
- [ ] 文件名和职责一致，没有循环依赖；
- [ ] 无新增 watcher、supervisor、轮询或全树 observer；
- [ ] renderer cleanup 对称，但恢复流程仍使用完整重启；
- [ ] 官方连接默认值未改变，凭据未持久化；
- [ ] 单元、事务、故障回退和隔离 A/B 全部通过；
- [ ] 稳态没有 codexctl 后台注入进程；
- [ ] 替换边界后没有旧 app-server、renderer 或 modifier monitor 残留；
- [ ] 文档与实际 CLI、架构和测试结果一致。
