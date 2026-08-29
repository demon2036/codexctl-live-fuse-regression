## WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001

- 类型：defect
- Parent revision：`305d0e982409c47cc1f7a3457f7c35389511d6d9`
- 用户可见偏差：Wallpaper 同时接管持久 docked Sidebar 和官方 floating Sidebar，把后者的宿主不透明 surface 清成透明，导致覆盖式历史栏与 Main 视觉重叠。
- 历史基线：一次性 runtime 之前的稳定实现只主题化 `aside.app-shell-left-panel`，不匹配 `app-shell-floating-left-panel`；docked Sidebar 的几何继续由官方 flex shell 管理。

### Red

最小命令：

```bash
node --test test/wallpaper-lite.test.mjs
npm run test:browser
node --experimental-websocket scripts/probe-wallpaper-bottom.mjs <isolated-port> --assert-sidebar
```

修复前失败断言：

- L1：`WALLPAPER-SIDEBAR-DOCKED-GEOMETRY-001` 在生成 CSS 中发现 `app-shell-floating-left-panel`。
- L3：真实 Chrome 中 docked Sidebar 的 `right <= Main.left` 与展开减少 Main 宽度均成立，但 floating Sidebar 的宿主 `rgb(17, 17, 17)` surface 被改成 `rgba(0, 0, 0, 0)`，断言 `host floating Sidebar surface must remain opaque` 失败。
- L4：修复前 revision 的真实隔离 App bounds 证明 docked Sidebar 与 Main 相邻，但 payload 仍命中 floating selector，断言 `Wallpaper must not theme the floating Sidebar` 失败。

### Green 条件

- Wallpaper 只主题化官方 docked `aside.app-shell-left-panel`；不得设置 floating Sidebar 或其直接 surface 的背景。
- docked Sidebar 展开后右边界不得越过 Main 左边界，且 Main 可用宽度必须小于收起状态。
- 不新增 position、inset、transform、display、width、observer、timer、worker 或输入/滚动处理。

### Green 验证

- L1 定向测试：11/11 通过。
- L3 真实 Google Chrome：docked 收起/展开 bounds 与 floating 宿主 surface 断言通过。
- L4 真实隔离 App：viewport `1512×889`；Sidebar 为 `0–353.9px`，Main 从 `353.9px` 开始，重叠为 `0px`；payload 不含 floating selector。
- 同一隔离 renderer 的 Wallpaper CSS on/off 对照中 Sidebar/Main bounds 字节级等价，证明注入未改官方 flex geometry。
- 隔离 App 的 Wallpaper observer/timer/layoutReads 为 0；Prompt/Context navigation/toast/bridge timer 为 0；测试 PID、临时 profile 与 launch receipt 已精确清理。
- `npm run check`、102 个 Node 测试、`npm run test:browser` 与 OpenSpec strict validation 全部通过。
