# 1.x LTS 维护与兼容性

`master` 是本仓库的稳定维护分支。1.x 接收缺陷、兼容性和安全修复；实验性功能在其他分支开发。发布使用固定版本标签，更新采用 fast-forward，不重写已发布标签。LTS 描述的是本项目的维护约束，不是 OpenAI 对此注入工具的支持承诺，也不表示已经保证所有未来 App 版本可用。

截至 2026-09-12，1.1.0 已完成发送恢复、布局与隔离 App 的功能验证，但整套性能与用户 Linux 实机验收尚未完成，因此尚未发布通过全部验收的 LTS 标签。已观测到的 CPU 输入/滚动预算失败和 Linux 首次启动空闲采样无效，必须按最终 revision 重新验证；不能将这里的维护政策视为全平台通过证明。

## 支持范围

| 项目 | 范围与验证边界 |
| --- | --- |
| Node.js | 最低 22；CI 覆盖 22、24。推荐 24 LTS。 |
| macOS | 当前 Live + loopback CDP 通道；实际 App 验证与隔离 Electron 验证分别记录。 |
| Linux x64 | Ubuntu 24.04 CI、实际发行包隔离验证；用户机器仍需同版本验收。 |
| Linux ARM64 | 共享 POSIX shell/Node 实现；实际 App、桌面后端与发行版需对应平台证据。 |
| Display | 默认服从 App；保留 XWayland/Wayland 显式选择。 |
| App 升级 | 按能力探测 renderer、请求管理器与模块回执，不按固定 App 版本号放行。 |

Node 20 已结束维护；旧安装说明中的 `20+` 还会使 Live 子进程缺少内置 WebSocket。因此安装器、CLI、doctor 和 CI 统一以 Node 22+ 为最低要求。[Node.js 发布状态](https://nodejs.org/en/about/previous-releases)

官方 Linux App 当前为预览版，支持范围和 Wayland 限制随上游发布变化。[官方 Linux 文档](https://learn.chatgpt.com/docs/linux/linux-app)

## 升级时的兼容策略

- 推荐 `codexctl live start`：使用动态 loopback CDP，不修改、解包、重签 App，不依赖 `NODE_OPTIONS` fuse。
- 每次启动重新发现实际 App 和配套内嵌 CLI；Home、XDG 目录、临时目录和架构取自当前机器。
- renderer 功能在有界探测后安装；无法识别内部能力时报告不兼容并停止探测，不制造成功回执。
- 控件按实际尺寸和命中区域布局，原生输入框暂时消失时保留按钮；只观察 footer 和直接父节点，不扫描对话输出。
- Live 配对失败只清理本工具自己的资源，已启动的 Desktop 保持运行；一次性注入失败走完整官方恢复事务。
- 不支持的 UI 结构可能使增强功能隐藏或不可用。官方 App 与原始会话仍由官方程序管理，用户可通过完整退出后直接打开 App 恢复。

macOS `app --inject` 的一次性 preload 仍依赖 App 允许 `NODE_OPTIONS`；已禁用该 fuse 的构建应使用 Live。CDP 也属于上游可能改变的接口，因此仍需升级回归。[已知 fuse 问题](KNOWN_ISSUE_CODEX_26.901_NODE_OPTIONS.md)

## 安装、更新与回退

```bash
git clone --branch master https://github.com/demon2036/codexctl-live-fuse-regression.git codexctl
cd codexctl
./scripts/install.sh
codexctl doctor
```

先记下当前已验证提交，再在正常退出 App 后更新：

```bash
git rev-parse HEAD
git pull --ff-only origin master
./scripts/install.sh
codexctl doctor
codexctl live start
```

若新版增强功能不兼容，先正常退出 App，可直接打开官方 App 继续工作。需要回退本工具时，使用 `git switch --detach <之前记录的提交或发布标签>` 后重新运行安装器和 doctor，再启动 Live。配置状态位于仓库之外；不要复制其他机器的运行状态、socket、PID 记录或登录凭据。

`git pull` 本身不热更新正在运行的插件。日常更新通过完整退出后重开生效；开发会话中显式授权的 Live reload 另行验证。

## 发布验收

每个版本运行 `npm run check`、`npm test`、`npm run test:browser`、`npm run test:fast`，并保留实际 App/隔离 App/性能证据。`master` push 与 PR 都触发 CI。

L1–L3 通过不代表用户 Linux 机器已经验证。实际平台报告必须绑定最终 Git revision、`dirty=false`、App/CLI 版本和桌面后端；缺少平台或登录能力时记录 `unverified`，禁止写成全平台通过。详细门禁见 [TESTING.md](TESTING.md)。

当前维护约束没有承诺自动后台适配或某个支持截止日期；延长支持、增加平台或改变默认行为需要新的验证和版本说明。
