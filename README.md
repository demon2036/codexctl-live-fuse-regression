# codexctl

`codexctl` 是 macOS / Linux 的 Codex Desktop（部分 Linux 包显示为 ChatGPT）本地启动控制器。它提供三项彼此独立的可选功能：

- Developer Prompt profile；
- Context window / auto-compact preset；
- 本地 Wallpaper 主题。

默认连接永远是官方 OpenAI。macOS 默认启动与点击图标完全一致：走 LaunchServices、零参数、零 CDP、零注入。临时 relay 只由单次 `codexctl app -c ...` 启用，凭据不写配置、runtime 或 Git。

## 性能架构

当前版本把官方基线与私有 UI 功能分成两个明确入口；macOS 两条路径都兼容官方 Remote：

```text
codexctl app
  -> macOS LaunchServices / Linux 官方启动
  -> Remote-safe；不生成 runtime，不注入

codexctl app --inject
  -> 校验配置和资源
  -> 生成不可变 runtime
  -> 完整启动/替换 App
  -> macOS: LaunchServices + 零参数 + 启动期一次 preload
  -> Linux/隔离测试: loopback CDP one-shot
  -> 验证 PID、revision 与性能合同，控制器退出
```

新 session 的 Provider 指示器默认显示 `OpenAI`。这个隐式默认不会额外写入
`thread/start.modelProvider`，因此仍由 App 的官方默认配置处理。若要让本次 App
生命周期内的每个新 session 默认使用已经在 `~/.codex/config.toml` 配置好的
Provider，可显式启动：

```bash
codexctl app --inject --provider polo
```

此时 `polo` 会作为新 session 的启动默认值注入请求；App 内 Provider 菜单仍可为
下一次新 session 做一次性覆盖，历史 session 始终保持其创建时记录的 Provider。
`--provider` 只携带 Provider ID，不读取或复制其 Base URL、环境变量名或 API Key，
也不会改写 `config.toml`。它需要 Prompt 或 Context 模块已开启，并且不能和 `-c`
relay 在同一次启动中混用。

稳态没有 watcher、supervisor、轮询或注入 worker。Wallpaper renderer 不创建 `MutationObserver` 和 timer；Prompt/Context 不观察整棵文档树，打字和流式输出不会触发 DOM reconciliation。

配置命令不会热修改当前窗口。修改后显式运行 `codexctl app --inject` 才会跨完整 App 进程边界重启并一次性注入。需要 Remote 或恢复官方性能时运行 `codexctl app`；已注入 renderer 不会被热撤销后继续复用。这样做是因为热清理无法证明 Chromium 的 JS heap、样式/合成缓存、client patch 和框架状态已恢复；“删除 DOM 后仍卡，完整关闭重开才恢复”属于明确的恢复边界。

## 安装

需要 Node.js 20+。

```bash
git clone https://github.com/demon2036/codexctl.git
cd codexctl
./scripts/install.sh
```

默认安装到 `~/.local/bin/codexctl`。可用 `CODEXCTL_BIN_DIR` 改位置：

```bash
CODEXCTL_BIN_DIR=/usr/local/bin ./scripts/install.sh
```

安装器不创建自动启动项。若旧版本曾启用自动注入，运行 `codexctl clean` 会卸载属于当前 controller home 的旧启动项并停止残留进程。

## 快速开始

查看配置与环境：

```bash
codexctl status
codexctl doctor
```

选择内置壁纸并开启三个模块：

```bash
codexctl wallpaper list
codexctl wallpaper use yuugohan-tsuri
codexctl prompt on
codexctl context on
codexctl app --inject
```

最后一条命令会完整启动 App、完成一次性注入，然后退出控制器进程。macOS 主进程仍是 LaunchServices 零参数实例，不开启 DevTools，官方 Remote 可正常连接。不要再执行 `auto on` 或 `inject start`；常驻模式已经删除。

## 项目启动策略

仓库根目录的 `codexctl.yaml` 是唯一项目级启动策略：

```yaml
launch:
  defaultMode: remote-safe
  injection: explicit
  macOfficial: launch-services
  officialCli: embedded
environment:
  persist: false
relay:
  proxy: null
  noProxy: localhost,127.0.0.1,::1
```

它是严格校验的两级 YAML；未知字段、环境持久化、PATH CLI、代理凭据和非 Remote-safe 默认值都会被拒绝。`officialCli: embedded` 确保图标启动和 `--inject` 使用与 App 版本成套的 CLI，避免 Remote/Browser 协议版本偏移。可把不含凭据的 `relay.proxy` 写在这里；只有显式 `app -c` 时才采用，命令行 `proxy=` 优先。API key 仍只能由单次参数或 `key_env` 提供。

## Developer Prompt

```bash
codexctl prompt add work ./prompts/work.md --label Work
codexctl prompt use work
codexctl prompt on
codexctl prompt list
codexctl prompt status
```

`default` 使用官方内置 instructions。历史 thread 继续使用 rollout 中原有 instructions，避免把旧记录的语义静默改掉。

App 内的 `Next Base` 是严格 one-shot：选择只由紧接着发起的新 task 消费一次，创建成功后立即恢复配置的默认 profile（默认是 `default`）；创建失败且期间没有更新的 task 边界或用户选择时才恢复该 one-shot。当前和历史 task 的 rollout 都不会被改写。控件挂在 React root 外，并用原生 CSS anchor 跟随 Permissions 按钮；composer 输入重绘或增高不会删除控件，也不触发 JS 重定位。

Prompt 文件必须是可读普通文件，大小 1 byte–4 MiB。runtime 记录绝对路径和 SHA-256，不复制或删除原文件。

## Context / Compact

内置 preset：

```bash
codexctl context list
codexctl context use native
codexctl context use oai
codexctl context use 400k
codexctl context on
```

`native` 不写 context 或 compact override，完全保留官方 model/provider 默认。自定义示例：

```bash
codexctl context set 384k \
  --compact 340k \
  --scope body_after_prefix \
  --id lab \
  --label "Lab 384K"
```

Context 与 Prompt 开关互不依赖。请求转换只修改对应字段，并保留其他 config。

App 内的 `Context` 控件控制当前 task，并显示配置档位和实际 runtime effective window。空闲 task 选择任意合法档位会立即走官方 resume 边界；回复生成中只保留最后一个合法目标，本轮继续完成，目标在下一次模型请求发出前应用。缩小 window 或 compact 阈值时保留历史，若已超过新阈值则由下一轮按新配置先自动 compact。

`native` 先按当前 task 已观测的官方容量参与切换判定；合法切换不写 window/compact override，容量未知时保持当前 task 不变。Context 从不使用 Prompt 专属的“只对下一个 task 生效”语义。272K/450K 的 runtime effective 映射分别是 258.4K/427.5K；旧 usage 只保持 pending，下一条 fresh usage 才能确认或回滚。

### Context Usage 面板

已建立的 task 会在 `Context` 旁显示紧凑的 `Usage` 百分比。打开后可查看：

- `Current context`：当前 tokens、runtime effective window、剩余量和占比；
- `Prompt cache`：上一轮与整个会话的 cached/input tokens、命中率和本轮未缓存输入；
- `Context sources`：tool calls、developer、messages、tool definitions、reasoning、system prompt 等来源；
- `Compaction`：已观测的 compact 次数，以及最后一次距今多少轮。

Context 与 Prompt cache 直接读取当前 App 已经持有的 usage 对象，属于精确 runtime 数据；字段不存在时显示 `—`，不会补造数字。`Context sources` 只有在 runtime 明确提供 breakdown 时才标记 `Exact`；否则只读扫描当前会话可见条目、按 authoritative current-context 总量缩放并标记 `Estimated`，无法可靠归类的部分单列为 `Unclassified runtime context`。这种降级不会启动代理、daemon、rollout 文件抓取或网络请求。

该面板是 `codexctl` runtime 中的临时 body-level overlay：不修改、解包重打包或重新签名 `Codex.app` / `app.asar`，不替换官方资源，不改写会话对象或 Codex 用户数据。关闭受管实例后 overlay 随 renderer 一起消失，因此同一套 `codexctl` 代码可以复制到其他兼容机器；若未来 App 内部只读对象改名，最坏结果是指标显示不可用，而不是修改官方程序来强行适配。

## Wallpaper

使用内置主题：

```bash
codexctl wallpaper list
codexctl wallpaper use yuugohan-tsuri
codexctl wallpaper on
```

直接使用图片：

```bash
codexctl wallpaper set ./wallpaper.webp \
  --appearance dark \
  --opacity 0.22 \
  --focus-x 0.72 \
  --focus-y 0.54
```

创建和搬运主题：

```bash
codexctl wallpaper create quiet-sea ./sea.webp --name "Quiet Sea"
codexctl wallpaper export quiet-sea ./quiet-sea.zip --source user
codexctl wallpaper import ./quiet-sea.zip
```

主题和图片在加载前经过路径包含、符号链接、稳定读取、大小、图片签名、JSON schema 和 Safe CSS 校验。Safe CSS 只允许注册的 `data-ds-part`、有限属性和值；`:has()`、blur/filter 等高风险或高成本内容在编译边界被拒绝或降级。

## 官方连接与临时 relay

正常启动：

```bash
codexctl app
```

单次 relay：

```bash
export MY_OPENAI_KEY='...'
codexctl app -c 'url=https://relay.example/v1;key_env=MY_OPENAI_KEY;proxy=http://127.0.0.1:10808'
```

不带 `-c` 的 macOS 模式都由 LaunchServices 启动。注入模式仅在这一次启动请求中传入项目内 hook 与不可变 runtime 路径；hook 在主进程最早期读取后立即删除其 Node 环境，并且不会把它传给 app-server。整个流程不修改 shell、launchd、`config.toml` 或用户级环境。relay/隔离模式仍只为本次子进程构造环境。

如果官方 App 报 `Model provider ... not found`，先检查 `~/.codex/config.toml` 是否已经定义对应 Provider；若要恢复官方路由，去掉 `--provider` 后完整退出并重开 App。`codexctl` 不改写 `config.toml`，只会在显式启动的不可变 runtime 中记录非敏感 Provider ID。

## 清理与恢复

```bash
codexctl clean
```

它会：

- 原子关闭三个模块；
- 卸载属于当前 controller home 的旧自动启动项；
- 停止精确识别的旧 worker/supervisor；
- 关闭受管隔离测试实例；
- 如果主 App 曾注入，完整替换为无 CDP、无注入的官方 App；
- 保持未知或不属于当前 controller 的实例不动并报告。

低级 `--remove` 只用于测试，不能作为性能恢复承诺。

## 测试与代码质量

```bash
npm run check
npm test
npm run test:browser
npm run test:fast
npm run test:app
npm run test:platform
npm run test:regression
```

`npm run check` 包含语法、循环依赖、敏感信息、renderer 模板组装、catalog/schema/预算/执行器映射和每文件最多 400 行的硬门禁。70 个必选场景的生成索引见 [回归 Case Catalog](docs/REGRESSION_CATALOG.md)；完整流程、性能预算和 review 清单见 [代码与性能 SOP](docs/CODE_SOP.md)。

更详细的系统说明：

- [架构](docs/ARCHITECTURE.md)
- [测试](docs/TESTING.md)
- [Linux](docs/LINUX.md)
- [Legacy 对齐](docs/LEGACY_PARITY.md)

## 安全边界

- macOS official 与 preload 注入都必须使用 LaunchServices，App argv 为空，禁止 DevTools flag；
- Linux/隔离测试的 CDP 只使用动态 loopback 端口，并验证 `app://` target 与 target id；
- 进程操作必须同时匹配 PID、启动时间、命令和 controller 记录；
- relay key 不进入 argv、配置、runtime、日志或提交；
- 未知调试实例和其他 controller 的全局启动项不会被接管；
- 导入主题在独立 stage 校验完成后才提交。
