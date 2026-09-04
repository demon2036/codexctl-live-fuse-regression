# Linux 使用说明

Linux 发行包可能显示为 ChatGPT，而不是 Codex；控制器按实际 Electron executable 和 `app://` renderer 识别，不依赖窗口标题。

## 要求

- Node.js 20+；
- glibc 环境的官方 ChatGPT/Codex Desktop 包；
- X11、XWayland 或 Wayland 会话；
- 可选 `zenity`/`kdialog`，只用于文件选择。

先运行：

```bash
codexctl doctor
codexctl app --dry-run
```

`doctor` 会报告 executable、内嵌 CLI、display/session、runtime、旧启动项和残留进程。

## Display backend

配置文件中的 `app.linuxDisplay` 支持：

- `auto`：服从官方 App 默认；
- `xwayland`：显式使用 X11 Ozone；
- `wayland`：显式使用 Wayland Ozone。

优先 `auto`。输入法、窗口定位或 GPU 问题明确指向 backend 时再切换，并在相同 backend 下做官方/注入 A/B。

## 一次性启动

```bash
codexctl wallpaper use yuugohan-tsuri
codexctl prompt on
codexctl context on
codexctl app --inject
```

Linux 与 macOS 使用同一个 runtime 和 renderer payload；Linux 通过 loopback CDP one-shot，macOS 通过 Remote-compatible LaunchServices preload。启动后 Node 控制器全部退出；不会创建 XDG autostart、systemd user service、watcher 或 supervisor。

从桌面菜单直接打开官方 App 不会自动注入。若需要三项功能，使用 `codexctl app --inject` 或自行创建只执行这一条命令的桌面快捷方式；快捷方式本身不能常驻。不带 `--inject` 的 `codexctl app` 保持官方 Remote-safe 行为。

## 包发现

控制器支持真实 executable 和 shell launcher。launcher 解析后必须落在允许的 package layout，且最终进程身份会记录到 managed launch。未知 executable、多个非隔离 primary 或未知 CDP port 都会 fail closed。

## GPU 与性能

Wallpaper 只使用静态 CSS、Blob URL 和稳定选择器，不执行 Linux 特有图片服务器。若看到额外本地 asset port、wallpaper worker 或周期 CPU，说明存在旧版本残留：

```bash
codexctl clean
codexctl doctor
```

性能对比必须使用相同 display backend、缩放、窗口尺寸和 App 构建。Wayland/XWayland 的 compositor 行为本身可能改变 scroll 与 input latency，不能把跨 backend 数据当作注入差异。

实际发行包的 L5 命令为：

```bash
npm run test:platform
```

它使用唯一临时 HOME/profile、动态 loopback CDP、匹配的 `app://` target 和一次性连接，验证 Remote、视觉/交互、单一 app-server、连接关闭、无持久状态和零残留。缺少 display、实际包、登录或目标 renderer 时必须报告 `unverified`，不能用 Chromium/Electron fixture 伪造 Linux 平台 pass。跨平台发布结论还需要同一 revision 的 macOS actual 证据。

## Relay

Linux relay 同样只存在一次启动：

```bash
export MY_OPENAI_KEY='...'
codexctl app -c 'url=https://relay.example/v1;key_env=MY_OPENAI_KEY'
```

不带 `-c` 时恢复 official 并清理旧 provider 环境。relay 配置不会写入 `~/.codex/config.toml`。

## 清理

```bash
codexctl clean
```

清理会移除属于当前 controller home 的历史 XDG autostart 文件、停止精确匹配的旧进程、关闭受管隔离实例，并对曾注入的 primary 做完整官方重启。其他用户、其他 controller、未知 PID 和未知 port 不会被操作。
