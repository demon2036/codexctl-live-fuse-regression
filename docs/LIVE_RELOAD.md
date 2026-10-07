# Live 代码更新

目标：更新本项目的运行代码时，保持 Codex 的 App PID、页面和未发送内容。

## 使用

```bash
codexctl live reload
codexctl live reload --all
codexctl live reload wallpaper
codexctl live dev wallpaper --source ./assets/wallpapers/yuugohan-tsuri --watch
codexctl live dev stop wallpaper
```

前两个命令等价。指定插件时更新该插件的稳定版本；辅助程序及其依赖仍全部从新进程加载。
Prompt、Context、Provider 共用 controls，因此更新其中一个会重新构建这个共享部分。
开始调试也会加载新进程，所以先改代码、后运行 `dev` 同样生效。
调试期间保留稳定版本；停止调试会恢复它。需要采用调试后的代码时，停止调试后执行 reload。

`--watch` 仅在显式调试期间运行。它监听项目运行源码以及指定调试目录，合并连续文件事件。
它不监听 Git 元数据、依赖安装目录、文档、测试和回归产物。语法错误不会关闭 App；修复文件后
仍可继续自动更新。手动 reload 则始终从磁盘重新加载辅助程序的完整依赖。

## 范围

| 修改 | 生效方式 |
| --- | --- |
| 壁纸生成器、CSS、主题、图片 | Live reload；调试目录和运行代码可 watch |
| Prompt / Context / Provider renderer | 新进程重新编译，再替换当前页面中的插件 |
| companion、CDP 适配器、模块依赖、更新实现 | 新辅助进程读取最新代码，沿用现有 App 和端口 |
| CLI 命令实现 | 下一次命令调用自然加载新代码 |
| App 启动参数、代理、app-server 启动环境、原生启动钩子 | 下次 App 启动 |
| Codex 官方程序、Electron 或 Node 本体 | 对应程序的升级流程 |

这不是对任意损坏代码或不兼容协议变更的成功承诺。候选版本必须通过构建、握手、挂载检查；
失败时保留或恢复旧版本。没有既有 Live 通道时，不会接管普通 App。
正在运行的旧版辅助程序不会因为改文件而自动升级；本能力需由新版辅助程序加载后提供。

## 实现

1. 暂停旧服务的修改请求和自动重载回调，继续记录文件变化，保留旧代码和产物。
2. 启动新辅助进程，经父子 IPC 传递插件开关、调试源和恢复版本。
3. 新进程重新加载 ESM/CJS 依赖并构建产物；准备期间源码变化则中止。
4. 校验 App PID、启动时间、命令和可执行文件，交出旧连接。
5. 新进程在同一 App 中挂载并验证产物。失败时旧进程重连恢复。
6. 成功后退出旧辅助进程。CLI 的成功响应写出后才关闭旧命令通道。

更新控制流程不调用 App 退出、页面刷新或导航操作。仅终止本次创建的候选辅助进程。
主题缓存包含源码指纹，因此不能把修改前的产物当作新版本复用。

## 验证

```bash
node --test test/live-reload.test.mjs
npm run test:live
```

Red 基线为 `0d5346ff09d522ce42abcf9de6f662885c0e65d5` 加已有工作区修改。
首次运行 `node --test test/live-reload.test.mjs` 时，
`the displayed wallpaper must include the new compiler output` 断言失败：新进程仍读到旧目录缓存。
修复后该断言通过。独立 Electron 检查还覆盖完整进程接管、语法/挂载失败回退、watch 恢复、
调试前的版本恢复、开关保留、DOM 不累积及进程清理。官方 App 主窗口与跨平台 L5 验收另行记录。
