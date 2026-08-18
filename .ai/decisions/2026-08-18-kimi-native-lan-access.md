# ADR · Kimi Native LAN Access

| 项 | 值 |
|---|---|
| 日期 | 2026-08-18 |
| 状态 | Accepted |
| 范围 | KickSide 第一阶段 Kimi Code 局域网访问 |

## Context

Kimi Code 原生支持 `--host 0.0.0.0`、Bearer Token 与 Host 校验，并在非 loopback bind 下默认关闭远程 terminal、shutdown 和 debug。当前需求只覆盖可信局域网中的 Kimi Code，旧 Gateway 方案为 Kimi + DSH、设备配对和细粒度策略解决了更大问题，超出 MVP。

## Decision

1. KickSide 不新增 LAN Gateway 或第二个 sidecar。关闭时继续以默认 loopback 启动 Kimi；开启时只额外传 `--host 0.0.0.0`。
2. 局域网状态只保存在当前 `AppState`，每次应用进程启动默认关闭，不修改 `AppSettings` schema、Grid、locator 或其他持久化状态。
3. 只允许 `OwnedByShell` runtime 切换。`ReusedExternal` 永不停止、重启或修改，并在控制中心显示不可切换原因。
4. 切换是事务：确认没有 running session，停止 owned Kimi，按目标模式启动并验证 registry、loopback health 与 Bearer auth；失败时恢复旧模式并再次验证。
5. 外部复用仍只接受 loopback registry/lock。只有 PID 属于本次 owned 进程或进程组、启动时间窗成立、端口属于本次启动且 health/auth 通过时，wildcard registry 才可映射为本机 probe origin。
6. Kimi bearer auth 永不关闭；不得传 `--dangerous-bypass-auth`、`--allow-remote-terminals`、`--allow-remote-shutdown` 或 `--debug-endpoints`。
7. 状态接口只返回私有 IPv4 与无 token URL。完整 `#token=` launch URL 与二维码只由 main window 在用户显式操作时临时生成，前端关闭二维码后清空内存；不写日志、诊断或持久化状态。
8. P0 不自动修改 Windows/macOS 防火墙。UI 明示仅限可信家庭/办公网络及 HTTP 风险，并提供无地址/外部 runtime/切换失败提示。
9. DSH 不进入本阶段。旧 Gateway ADR 与详细文档降级为未来备选，仅在 DSH 必须远程访问或需要设备级权限控制时重新立项。
10. 网卡枚举使用跨平台 `get_if_addrs`；第一版以私有 IPv4 + 保守接口名过滤排除 loopback、link-local、容器、虚拟机和 VPN/tunnel 地址。地址只用于展示，不影响 Kimi 的 wildcard bind。
11. Kimi 0.36.1 的 HTML 固定返回 `frame-ancestors 'self'`，因此 wildcard 模式下 App 的 Tauri iframe 不能直连。仅在 owned LAN 模式启动既有 Rust workspace proxy 作为随机 loopback 嵌入适配器：手机仍直连 Kimi 端口；适配器只为 HTML 把 `frame-ancestors` 改写为 `'self'` 加受控 Tauri origins，并转发 Bearer/REST/WS。它不监听 LAN、不提供配对/授权、不进入 locator，也不恢复旧 HTML 产品注入。

## Consequences

- 收益：删除公开 Gateway、配对、Cookie、第二 sidecar 与额外 CI/签名表面；主路径只改变既有 owned Kimi 生命周期。LAN 模式额外保留一个仅 loopback 的 App 嵌入适配器，以满足上游 CSP。
- 限制：局域网模式会让同一 Kimi Server 的 PTY 路由在本机也不可用；HTTP 不能抵抗同网段监听或篡改；防火墙和 AP Isolation 仍可能阻止外部设备。
- 发布门：Rust/TS 自动化只证明参数、状态和事务边界；Windows/macOS 实机、手机访问与防火墙行为仍需 G3，不能由本机单测外推。
