# ADR · LAN Gateway Sidecar 与 Loopback 边界

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17 |
| 状态 | Superseded（2026-08-18；仅作未来 Gateway 备选架构） |
| 范围 | KickSide Kimi Code LAN Access P0；为后续 DSH LAN Access P1 规定边界 |

## Context

> 本决策已被 `2026-08-18-kimi-native-lan-access.md` 取代。当前 MVP 不建设 Gateway、不支持 DSH 局域网访问；只有未来出现 DSH 安全远程需求或设备级权限控制需求时，才重新评审本文。

KickSide 当前只信任并管理 loopback 上的 Kimi Code 与 DSH Runtime。用户希望从同一可信局域网中的手机或其他电脑访问这些 Runtime，但直接把上游改为监听 `0.0.0.0` 会扩大 Kimi 的本机能力面，并绕过 DSH 明确拒绝公开绑定的安全意图。现有 workspace proxy 与 Kimi DOM 注入耦合，是本地兼容路径，不具备公开入口所需的配对、Session、来源限制、速率限制和审计边界。

浏览器免安装方案在第一阶段只能使用私有 IPv4 上的 HTTP。它能提供低摩擦的扫码访问，但不能抵抗同网段窃听或主动中间人攻击。Windows 防火墙、macOS 嵌套二进制签名、移动 Safari/Chrome 以及两套上游 WebSocket 协议必须经过 M0 与 G3 真机验证，不能由单元测试推断。

## Decision

1. 新增独立 Go sidecar `apps/kickside-lan-gateway`。Tauri/Rust 只负责设置、preflight、受管进程生命周期、运行时 target 投影和状态映射；Gateway 负责 public listener、配对、短期 Session、HTTP/WebSocket 代理、来源防护、策略与审计。
2. Kimi Code 与 DSH 永久保持精确 loopback HTTP target。Gateway 不修改上游 bind host，不关闭 Kimi bearer auth，也不让 React 直接 spawn 或 kill sidecar。
3. P0 使用“可信局域网中的 HTTP 远程控制”产品语义。它不宣称 HTTPS、抗同网段攻击、只读或 sandbox；Public/unknown 网络默认拒绝开启。
4. Portal、Kimi 与 DSH 使用同一选定私有 IPv4 上的三个独立端口，避免对两套 SPA 的根资源、`/api` 与 WebSocket 做子路径重写。Admin API 仅监听 loopback。
5. QR 配对 secret、手动码、Gateway Session 与 service ticket 只存在内存；每次应用进程都从 stopped 开始。Cookie 按 Portal/Kimi/DSH 分名，Gateway stop、网络变化或撤销会令其失效。
6. Kimi 继续使用官方 token bootstrap。Gateway Session 是额外门槛；Kimi token 只从受控 token file 读取，不能进入 argv、设置、Grid、locator、日志、诊断或遥测。
7. Kimi 路由策略默认拒绝 PTY、shutdown、debug、远程 OAuth、Provider secret 写入和高风险主机文件/原生 UI 操作。该策略只是防御纵深；Agent 经审批后仍可能修改文件或执行命令。
8. DSH 属于第二阶段 full-control surface，默认关闭；每个 Gateway generation 首次开启都必须阻断式确认。P1 不伪造方法级只读 RBAC，也不改变 DSH singleton 生命周期。
9. Gateway 使用 Go 1.26.6 或更高版本，并在 CI 执行 vet、test、race 与 govulncheck。M0 在 Go 1.26.5 上发现 GO-2026-6090、GO-2026-6089、GO-2026-5972 与 GO-2026-5026 的可达标准库路径，因此安全下限高于原 research 的 1.26.3。admin token 与其他秘密只通过环境变量或权限受限的 token file 传递，所有 stdout/stderr 与本地日志必须先脱敏。
10. M0 的 Kimi/DSH 真实代理、移动浏览器、Windows/macOS listener/防火墙和停止/撤销验证是进入正式产品代码的硬门。P0 与 P1 分阶段交付；P1 还要求 P0 Gateway 的双平台 G3 稳定证据。
11. 未来 Tailscale、受信证书或云中继只作为新的 public transport 接入 Gateway，不直接暴露 Runtime。第二种 transport 真正出现前不建立通用 provider registry。
12. 后续持久设置使用 `configured` 表达用户已配置过该功能，不能把它解释为自动启动意图。Gateway 在所有 App Quit、updater 与 parent-death 路径都必须停止，因此不暴露 `stopOnExit=false` 这一无安全合法语义的配置；退出停止是恒定不变量。

## Threat Model

### 保护对象

- Kimi bearer token、Gateway admin token、pair secret、Session cookie 与 service ticket；
- 用户工作区、主机文件、终端、Provider 凭据与 Runtime 生命周期；
- KickSide owned process、listener、日志和诊断包。

### 信任边界

- Tauri 主进程与它持有的 sidecar process identity 属于受信控制面；
- Kimi/DSH 只作为 loopback upstream，不取得 LAN authority；
- 已配对浏览器只取得当前 Gateway generation、当前来源 IP 和明确 service scope；
- 同一局域网、路由器、DNS 与 HTTP 链路不被视为机密或防篡改通道。

### 必须缓解的威胁

- DNS rebinding、伪造 Host/Origin、cross-site 请求与 forwarded header 欺骗；
- 未配对访问、配对重放/暴力尝试、ticket 跨 service 或跨来源复用；
- Gateway Cookie 泄漏到 upstream、upstream 覆盖保留 Cookie、token/subprotocol 进入日志；
- 非 loopback target、陈旧 target、网络切换后继续监听、stop/revoke 后活跃 WebSocket 残留；
- header/body/连接资源耗尽和 malformed request 导致的进程崩溃；
- 通过 Kimi 高风险路由或默认关闭的 DSH surface 扩大主机控制面。

### 明确不缓解的威胁

- 同网段被动窃听、ARP/DNS 欺骗和主动中间人；
- 已配对且被用户信任设备上的恶意脚本或浏览器扩展；
- 用户明确批准的 Agent 工具执行所带来的工作区修改；
- 公网、NAT 穿透、跨 VLAN 与访客网络隔离。

## Consequences

- 收益：upstream 的 loopback authority 不变，公共入口可统一停止、撤销和审计；Kimi P0 与 DSH P1 可以独立回滚。
- 代价：新增一个 Go sidecar、三端口防火墙面和跨 Rust/Go/TS 契约；HTTP 方案必须长期显示可信网络限制。
- 进入产品实现前必须完成 M0 Go/No-Go。缺少 Windows、签名 macOS 或 iOS/Android 真机证据时，只能声明相关代码“已实现”或自动化层“已验证”，不能声明发布完成。
- 如果未来出现第二个 transport，再以真实重复评估抽取 listener seam；当前只共享已被 Bridge/Gateway 第二次证明的构建 target mapping，不抽象生命周期 manager。
