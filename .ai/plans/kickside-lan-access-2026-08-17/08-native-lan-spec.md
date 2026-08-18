# Spec · Kimi Native LAN Access

## 运行时状态

`RuntimeState` 增加非持久字段 `lan_access_enabled`、`lan_access_switching`、`lan_access_last_error`，默认均为关闭/空。启动参数只允许两种形态：

```text
local: web --no-open --port <port>
LAN:   web --no-open --port <port> --host 0.0.0.0
```

不得加入 auth bypass、remote terminal、remote shutdown 或 debug flags。

## Registry 边界

- external registry/legacy lock：只接受 localhost、127.0.0.1、::1。
- owned registry：额外接受 0.0.0.0 或 ::，但必须同时属于本次 child/process group、位于启动时间窗、使用本次端口，并通过 loopback health + Bearer auth。
- 所有本机 API、locator 与 workspace embed 继续使用 loopback origin，不把 wildcard 或 LAN IP写入 locator。

## 切换事务

1. 要求 Running + OwnedByShell。
2. 查询 session list；任何 `is_running` 为 true 时拒绝。
3. 标记 switching，记录旧模式。
4. 停止 owned process tree。
5. 设目标内存模式并启动。
6. 等待 registry/health/auth ready。
7. 成功提交；失败停止残留并按旧模式重启，分别报告切换和回滚结果。

## IPC

- `get_kimi_lan_access_status`：只返回状态、ownership、端口、私有 IPv4、无 fragment URL、tokenAvailable。
- `set_kimi_lan_access(enabled)`：事务式切换并返回新状态。
- `get_kimi_lan_launch_url(ip)`：重新校验 enabled/owned/IP/token，仅在调用时返回完整 URL 与 QR SVG。

三个命令仅授权 main window。完整 URL不得进入 AppStatus、settings、Grid、locator、日志、诊断或遥测。

## App 内嵌适配

Kimi 0.36.1 HTML 的 `frame-ancestors 'self'` 会阻止 Tauri iframe。仅当 `OwnedByShell + lan_access_enabled` 时，Shell 在随机 loopback 端口启动同 generation 的 workspace adapter：

- `runtime_origin`、locator 和所有 Rust API client 继续指向真实 Kimi loopback origin；
- `workspace_port/workspace_url` 指向 adapter，手机访问 URL仍指向真实 LAN Kimi 端口；
- HTML CSP 只替换 `frame-ancestors` 为 `'self'` 与受控 Tauri origins，其余 CSP 保留；冲突的 `X-Frame-Options` 不转发；
- REST、静态资源与 WebSocket 透明转发，Authorization/Cookie/WS subprotocol 永不进入 adapter 日志；
- adapter 只绑定 `127.0.0.1`，generation 状态不再是 Starting/Running 后有界退出；不执行旧 workspace HTML 产品注入。

## 网卡与 UI

使用 `get_if_addrs` 枚举 IPv4；只保留 RFC1918，排除 loopback/link-local 及名称命中容器、VM、VPN/tunnel 的接口。过滤是展示启发式，不改变 wildcard bind。

控制中心复用 settings row、系统字体、中性色与绿色 enabled 状态。开启前使用原生 warning dialog；二维码关闭或折叠后清空 React 内存。
