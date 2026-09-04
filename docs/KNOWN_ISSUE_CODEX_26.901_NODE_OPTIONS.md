# Known issue: `codexctl live start` cannot pair with Codex 26.901

## Summary

`codexctl live start` currently cannot establish its local live-host connection with
Codex/ChatGPT Desktop `26.901.22334` on macOS. The App opens, but the expected Unix
domain socket is never created. After the 20-second pairing deadline, `codexctl`
reports `connect ENOENT` and terminates the App process that it just launched.

This is a local Electron host-loading compatibility failure. It occurs before HTTP,
OAuth, WebSocket, or proxy routing is involved.

## Reproduction

```sh
HTTP_PROXY=http://127.0.0.1:10808 \
HTTPS_PROXY=http://127.0.0.1:10808 \
ALL_PROXY=http://127.0.0.1:10808 \
NO_PROXY=localhost,127.0.0.1,::1 \
http_proxy=http://127.0.0.1:10808 \
https_proxy=http://127.0.0.1:10808 \
all_proxy=http://127.0.0.1:10808 \
no_proxy=localhost,127.0.0.1,::1 \
codexctl live start --proxy-server=http://127.0.0.1:10808
```

Observed result:

```text
codexctl: connect ENOENT /private/tmp/codexctl-live-<uid>/<session-id>.host.sock
```

The same failure is expected without the proxy variables because the missing socket
is local and is required before any proxied network request can matter.

## Environment observed

- macOS, Apple Silicon
- App path: `/Applications/ChatGPT.app`
- Bundle identifier: `com.openai.codex`
- App version: `26.901.22334`
- App build: `7746`
- App signature: valid Notarized Developer ID from OpenAI OpCo, LLC
- Codex CLI: `0.153.2`

The Electron fuse wire in the current App contains:

```text
RunAsNode                              DISABLE
EnableNodeOptionsEnvironmentVariable  DISABLE
EnableNodeCliInspectArguments          DISABLE
EnableEmbeddedAsarIntegrityValidation  ENABLE
OnlyLoadAppFromAsar                    ENABLE
```

## Root cause

The macOS live-launch plan has a single host-loading path:

```js
environment: {
  ...plan.environment,
  CODEXCTL_LIVE_BOOTSTRAP: bootstrapFile,
  NODE_OPTIONS: `--require=${JSON.stringify(paths.liveHostHook)}`,
}
```

That `NODE_OPTIONS=--require=.../live-host.cjs` value is supposed to load the host
module in the Electron browser process. The host module then calls
`startLiveHostServer(...)`, which creates `<session-id>.host.sock`.

Codex `26.901.22334` has `EnableNodeOptionsEnvironmentVariable` disabled. Electron
therefore ignores `NODE_OPTIONS`, so `live-host.cjs` never runs and the socket cannot
be created. Electron also documents that most `NODE_OPTIONS`, including `--require`,
are not supported for packaged applications. The current design consequently relies
on a production Electron injection path that is no longer available.

References:

- <https://www.electronjs.org/docs/latest/tutorial/fuses>
- <https://www.electronjs.org/docs/latest/api/environment-variables>

## Why the App is terminated

The companion retries `ENOENT`/`ECONNREFUSED` every 50 ms for up to 20 seconds. When
pairing fails, `startLiveApp()` enters its rollback branch and calls
`terminateDesktopProcess()` for the newly detected App process. On macOS this requests
a normal quit and falls back to `SIGTERM`; remaining owned descendants may ultimately
receive `SIGKILL`.

An observed launch followed this exact timing:

```text
10:45:05  App process started
10:45:25  App process exited after SIGTERM
```

This explains the user-visible behavior: the App does not independently crash;
`codexctl` terminates it after the live-host pairing deadline expires.

## Relevant code

- `src/live-platform.mjs`: installs the `NODE_OPTIONS --require` hook.
- `src/live-host.cjs`: loads the bootstrap and starts the host socket server.
- `src/live-host-client.mjs`: retries the missing socket for 20 seconds.
- `src/live-companion.mjs`: initiates host pairing.
- `src/live-launch.mjs`: terminates the launched App when pairing fails.
- `src/desktop-processes.mjs`: implements the quit/`SIGTERM` process boundary.

## Compatibility evidence

Older local runs left successfully created live-host sockets, and historical App logs
show releases in the `26.818` through `26.825` range. The currently installed binary
is `26.901.22334`. The previous binary is no longer available, so the precise first
release that changed the effective host-loading behavior has not been identified.

What is directly established is:

1. the current App disables the `nodeOptions` fuse;
2. the current live implementation requires `NODE_OPTIONS --require`;
3. the host socket is never created;
4. the 20-second `ENOENT` deadline is followed by codexctl's own termination path.

## Suggested repair boundaries

This document intentionally does not implement a workaround. A safe fix should at
least satisfy both boundaries below:

1. Do not rely on `NODE_OPTIONS --require` for a signed, packaged production App;
   replace it with a supported host/integration mechanism.
2. Add a preflight compatibility gate. If the required host transport is unavailable,
   fail before launching the App and never terminate an otherwise usable official App.

---

## 中文说明

macOS 新版 Codex/ChatGPT Desktop `26.901.22334` 已禁用 Electron 的
`EnableNodeOptionsEnvironmentVariable` fuse。当前 `codexctl live start` 依赖
`NODE_OPTIONS=--require=live-host.cjs` 将宿主代码加载进 Electron 主进程，因此
新版 App 会忽略该入口，`<session-id>.host.sock` 永远不会生成。

伴随进程等待本地 socket 20 秒后报 `connect ENOENT`。随后 `live-launch.mjs`
进入失败回滚分支，主动结束刚启动的 App，所以用户看到的是“Codex 被自动
kill”。这不是代理、OAuth 或网络连接问题，也不是 App 自身随机崩溃。

修复应同时处理两点：使用受支持的宿主通信/加载方式替代 `NODE_OPTIONS`
注入；并在启动前增加兼容性检查，不支持时立即报错且不得关闭官方 App。
