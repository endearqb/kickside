# KickSide 局域网访问 · Research

> **状态：未来备选架构档案。** 本文的 LAN Gateway / DSH 路线已于 2026-08-18 被 Kimi Native LAN Access 取代，不再作为当前实现依据。仅在 DSH 必须远程访问或需要设备级权限控制时重新评审。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17 |
| 状态 | Research complete；供 PRD / Spec / Plan 使用 |
| KickSide 基线 | `endearqb/kickside` · `main` · `a9c916e60d1cce113c644dbb4adf51f530bb7959` · `v0.2.2` |
| Kimi Code 上游快照 | `MoonshotAI/kimi-code` · `main` · 2026-08-17 最新提交 `5dffed2545b5a5f9816611afd5f2c03fbe8399e7` |
| DSH 上游快照 | `deepseek-ai/deepseek-harness` · `master` · 2026-08-17 最新发布 `0.1.0-rc.7`；KickSide 当前仍固定 `0.1.0-rc.6` |
| 目标 | 为“第一阶段：Kimi Code 局域网访问”和“第二阶段：DSH 局域网访问”确定可实现、可验证、可回滚的产品与安全边界 |

---

## 0. 执行摘要

结论明确：**KickSide 可以直接集成局域网访问，而且比先做 Tailscale 外网访问更符合当前产品阶段。** 正确实现不是把 Kimi Code 或 DSH 改为监听 `0.0.0.0`，而是新增一个由 KickSide 管理的 **LAN Gateway**：

```text
手机 / 其他电脑浏览器
        │
        │ 可信家庭或办公局域网 · HTTP
        ▼
KickSide LAN Gateway
        ├─ 配对与短期会话
        ├─ Host / Origin / CSRF 防护
        ├─ HTTP / WebSocket 反向代理
        ├─ 高风险路由策略
        ├─ 设备撤销与审计
        │
        ├─ Kimi Code  http://127.0.0.1:<dynamic>
        └─ DSH        http://127.0.0.1:<dynamic>
```

推荐将 Gateway 实现为独立 Go sidecar：`apps/kickside-lan-gateway`。KickSide 已有 `kimi-im-bridge` Go sidecar 的跨平台构建、打包、进程监督、随机 admin token、loopback admin API 和日志脱敏经验；Go 标准库 `net/http/httputil.ReverseProxy` 又能稳定处理 HTTP、流式响应与 WebSocket upgrade。该方案比在 Tauri 主进程里引入一套 Rust 代理栈更隔离，也比直接放开两个上游服务更统一。

第一、二阶段必须保持以下边界：

1. Kimi Code 与 DSH 继续只监听 loopback，不修改现有 Runtime authority。
2. 局域网访问默认关闭；每次应用启动后需用户显式开启，P0 不自动恢复到新网络。
3. 第一阶段只开放 Kimi Code；第二阶段再增加默认关闭的 DSH 开关。
4. 浏览器访问采用局域网 IP + 三个独立端口：Portal / Kimi / DSH，避免两套 SPA 的根路径、`/api` 和 WebSocket 被子路径重写破坏。
5. 使用 QR + 一次性配对 Secret；配对成功后签发 Gateway 自己的短期 HttpOnly Cookie。
6. 第一版是明文 HTTP，**不能宣称抵抗同网段窃听或主动中间人攻击**；产品定位必须写成“可信局域网中的远程控制”。
7. Kimi 的官方 bearer token 仍保留；Gateway 鉴权与 Kimi token 形成双层门槛。禁止 `--dangerous-bypass-auth`。
8. DSH 没有部署级认证；第二阶段的 Gateway Session 是其唯一远程认证层，因此必须默认关闭并显示完整控制风险。
9. Gateway 默认拒绝 Kimi 远程 PTY、shutdown、debug 与若干主机原生操作；但这只是防御纵深，不代表只读，因为 Agent 本身仍可能在审批后运行命令和修改文件。
10. Go 构建最低使用 **Go 1.26.6**。原调研下限 1.26.3 只覆盖 `GO-2026-4976 / CVE-2026-39825`；M0 的 `govulncheck@v1.7.0` 在 Go 1.26.5 上又发现 GO-2026-6090、GO-2026-6089、GO-2026-5972 与 GO-2026-5026 的可达标准库路径，均由 1.26.6 修复。

---

## 1. 调研问题与范围

### 1.1 核心问题

1. 当前 KickSide 的 Kimi、DSH、Tauri、Go sidecar 架构是否适合新增 LAN Gateway？
2. Kimi Code 和 DSH 的 Web/HTTP/WebSocket 协议能否经反向代理工作？
3. 为什么不能只给两个 Runtime 加 `--host 0.0.0.0`？
4. 浏览器-only 的局域网访问能做到什么安全级别，不能做到什么？
5. 第一阶段和第二阶段应如何切分，避免把 Kimi 与 DSH 的风险混成一次大改？
6. Windows/macOS 防火墙、网卡变化、手机浏览器与公共 Wi-Fi 会带来哪些产品障碍？
7. 哪些相关开源项目的做法值得借鉴，哪些不应直接照搬？

### 1.2 本次非目标

- 不设计公网直接暴露、Cloudflare Tunnel、Tailscale Funnel 或自建云中继。
- 不把完整 Tauri 桌面 UI 改造成 Web 版。
- 不实现持久设备证书、长期免配对或多用户 RBAC。
- 不尝试把 DSH 当前 `rc.6` 自动升级到 `rc.7`。
- 不承诺在公共 Wi-Fi、企业隔离 VLAN、酒店网络或蜂窝网络中可用。
- 不把“关闭 PTY”误写成“只读 Agent”。

---

## 2. KickSide 当前架构事实

### 2.1 产品与平台

KickSide `v0.2.2` 是 Tauri v2 + React 桌面应用，支持 Windows x64 与 Apple Silicon macOS 13+。它在同一桌面壳中管理 Kimi Code、DeepSeek Harness、Workspace Grid、IM Bridge、Skill、诊断与更新。仓库 README 明确把“受控 loopback 地址”和“token 不进入 README、持久化布局或诊断输出”列为安全边界。

### 2.2 Kimi Runtime

当前主路径为：

```text
kimi web --no-open --port <basePort>
```

`backend_manager/lifecycle.rs` 的 `build_kimi_web_args()` 不传 `--host`，因此沿用 Kimi 默认 `127.0.0.1`。启动后 Shell：

- 从 Kimi instance registry 匹配当前 owned child；
- 验证 health 与 bearer auth；
- 保存 runtime origin、token path、redacted token；
- 在内存中组装 `?kimi_onboarded=1#token=<token>`；
- 只接受 loopback 外部实例，不能把任意 LAN server 误判为可复用实例。

这套 authority/ownership 规则不应因 LAN 功能而放宽。

### 2.3 DSH Runtime

当前 `dsh_manager.rs`：

- 固定 `@deepseek-ai/dsh@0.1.0-rc.6`；
- 受管安装到 KickSide 私有前缀；
- 只以 `web --port <port>` 启动；
- 端口通过 `TcpListener::bind(("127.0.0.1", port))` 分配；
- authority 固定为 `http://127.0.0.1:<port>`；
- 前端 `getTrustedDshRuntimeUrl()` 只接受精确 loopback URL；
- Runtime URL、PID、端口和状态不写入 Grid persisted state；
- P0 单后端实例由 Shell 持有 Child/process-group identity。

这说明 DSH 局域网访问必须在它外面增加认证代理，而不是改变 DSH 内部绑定。

### 2.4 现有本地 Workspace Proxy

`backend_manager/workspace_proxy.rs` 已经包含 HTTP 与 WebSocket 手工转发逻辑，但它的用途是 localhost 上的工作区脚本注入：

- 使用 `tiny_http`；
- 同步、线程式循环；
- 绑定固定 `127.0.0.1`；
- 与 Kimi DOM 注入和 enhanced local mode 耦合；
- 不具备配对、设备 Session、来源限制、速率限制和公开网络审计。

它可以作为行为测试参考，**不应扩展为正式 LAN Gateway**。继续叠加会把兼容路径长成新功能，违反项目宪法中“兼容层不得长出新功能”和“删除/替换劣质抽象优先于绕过”的治理原则。

### 2.5 Go Sidecar 现有能力

`apps/kimi-im-bridge` 与 `bridge_manager.rs` 提供了可直接借鉴的模式：

- Go sidecar 跨 Windows/macOS 构建；
- target triple 命名并通过 Tauri `externalBin` 打包；
- `CGO_ENABLED=0`、`-trimpath`、release strip；
- 随机 admin token，只通过环境变量或 token file 下发；
- loopback admin port、health/status、启动超时、端口重试；
- owned Child 生命周期与有界停止；
- stdout/stderr 落盘前脱敏；
- Tauri command、permission、build manifest 多处注册和一致性检查。

因此新增第二个 Go sidecar不是凭空引入新架构，而是复制已被仓库证明过一次的模式。由于“第二次出现允许提取、第三次必须评估抽象”，实施时可共享**构建脚本中的纯 target mapping/Go build utility**，但不应预建一个通用 sidecar framework。

### 2.6 设置与命令契约

当前 `CURRENT_SETTINGS_SCHEMA_VERSION = 13`。LAN 设置属于持久化契约，需：

- schema 升级；
- `#[serde(default)]` 兼容旧设置；
- 明确迁移测试；
- 默认 `enabled=false`；
- 不持久化实际 IP、实际端口、配对 Secret、Cookie、Kimi token 或运行 URL。

Tauri command 新增后必须同步：

1. `src-tauri/src/commands.rs`
2. `src-tauri/permissions/command-access.toml`
3. `src-tauri/build.rs`
4. capability 与 `scripts/check_command_registry.mjs`
5. 前端 service/type/controller 与测试

---

## 3. Kimi Code 上游协议与安全事实

### 3.1 默认服务模型

Kimi Code `kimi web` 同时提供：

- Web UI 静态资源；
- REST `/api/v1` 与部分 `/api/v2`；
- WebSocket `/api/v1/ws`；
- bearer-token 鉴权；
- instance registry 与 token 轮换。

默认地址为 `127.0.0.1:58627`，端口冲突时递增。静态资源和 `GET /api/v1/healthz` 免鉴权，其他 `/api/*`、OpenAPI 与 AsyncAPI 需要 token。

REST 使用：

```http
Authorization: Bearer <token>
```

浏览器 WebSocket 使用子协议：

```text
kimi-code.bearer.<token>
```

Web UI 官方启动 URL 使用：

```text
/#token=<token>
```

fragment 不会作为 HTTP URL 发送给服务器，适合继续作为 LAN Gateway 后的 Kimi bootstrap。

### 3.2 Host 与 Origin 防护

Kimi 有 DNS-rebinding Host 检查与 Origin/CORS 钩子：

- localhost、loopback、literal IP、bound host 默认允许；
- 其他 DNS host 需 `--allowed-host` 或 `KIMI_CODE_ALLOWED_HOSTS`；
- 有 Origin 时要求同源或显式 allowlist；
- WebSocket upgrade 复用相同判断。

Gateway 代理到 upstream 时把 `Host` 与 `Origin` 改写为真实 loopback authority，Kimi 不需要感知 LAN host，也不需要 `--host 0.0.0.0` 或额外 `--allowed-host`。

### 3.3 高风险 API 面

Kimi API 不只是聊天接口。官方参考中包括：

- `POST /api/v1/shutdown`；
- PTY terminal 列表/创建/关闭；
- Provider 与配置读写；
- OAuth 登录、登出与用户信息；
- 工作区 trust；
- 文件上传、下载与导出；
- `/api/v1/fs:browse`、`fs:home`、`fs:mkdir`；
- `GET /api/v1/fs:content`：读取本机任意文件原始字节；
- session filesystem `open` / `open-in` / `reveal` 等主机原生动作；
- debug endpoints；
- Agent tools、MCP、prompt、approval 与 shell 事件。

因为 upstream 仍是 loopback，Kimi 会挂载 loopback-only 的 PTY/shutdown 等能力。Gateway 若无差别转发，就等价于把本地能力带到局域网。因此第一阶段必须有 Gateway 路由策略；默认至少阻断：

```text
POST /api/v1/shutdown
/api/v1/debug/*
/api/v1/sessions/*/terminals*
远程 OAuth login/logout
主机任意文件读取与绝对目录操作
主机原生 open/open-in/reveal
```

这不是完整 sandbox。即使阻断这些路由，远程用户仍可以向 Agent 提交 prompt，Agent 可能在自身 permission/approval 机制下修改工作区或执行命令。产品文案必须使用“远程控制”，不能使用“只读查看”。

### 3.4 代理兼容要求

Kimi 代理必须覆盖：

- REST envelope 与非标准 HTTP 200 业务错误；
- 单一 WebSocket `/api/v1/ws`；
- WebSocket subprotocol 原样转发；
- 流式增量与断线重连；
- multipart 上传；
- Range / ETag 二进制下载；
- 302/Location 改写；
- token rotation 后重新 bootstrap；
- `?kimi_onboarded=1` query 与 `#token=` fragment。

---

## 4. DeepSeek Harness 上游协议与安全事实

### 4.1 当前版本差异

2026-08-17，DSH 上游发布 `0.1.0-rc.7`，KickSide 当前固定 `rc.6`。这不是本项目自动升级理由，而是兼容风险信号：Gateway 测试必须同时记录“KickSide pin”与“上游 latest observation”，并将 pin 升级作为独立变更。

### 4.2 Web CLI 对远程绑定的态度

DSH 当前 Web CLI 解析：

```text
--host
--port
--trusted-host
```

但明确拒绝 `--host 0.0.0.0`，错误文案说明这会向网络暴露远程代码执行能力。底层 webserver package 虽能接受 `0.0.0.0`，CLI 组合层在认证能力出现前有意禁止。

因此修改 KickSide 的 `dsh_web_args()` 让 DSH 直接监听 LAN，既违背上游当前安全意图，也会让 KickSide 独自承担没有认证的 RCE 表面。

### 4.3 DSH Web 协议

DSH 浏览器层使用：

- HTTP `/api/<method>` 处理 unary/respond RPC；M0 在 rc.6 实测 `POST /api/host.describe` 为 200，而 `POST /api` 为 404；
- WebSocket `/api/events.mux`；
- WebSocket `/api/events.host`；
- Web 静态资源与 SPA fallback。

连接就绪依赖两条下行 WebSocket 都打开，并成功执行 `host.describe`。Gateway 不能只测试首页 200；第二阶段必须覆盖两条 WS、RPC、会话创建、流式输出、审批、文件操作和 Bash。

### 4.4 Browser trust fence 不是认证

DSH 的 `/api/<method>` trust fence：

- Host 必须是 loopback 或已声明 `trustedHosts`；
- 有 Origin 时必须与 Host authority 完全一致；
- `Sec-Fetch-Site: cross-site` 拒绝；
- POST 必须是 `application/json`；
- 该机制防止 DNS rebinding/浏览器混淆代理人；
- **它不是用户认证层**。

Gateway 完成配对鉴权后把 upstream Host/Origin 改写为 `127.0.0.1:<dshPort>`，DSH 继续按 loopback 模式运行，不必增加 `--trusted-host`。

### 4.5 风险面

DSH 文档明确：默认 agent preset 本身带 Bash；RPC 面还包括设置、凭据、主机原生打开路径等特权能力。rc.6 的 unary 路径包含 method 名，但 method surface 与 body contract 会随版本变化，且默认 preset 本身已有 Bash；第二阶段不能把不完整的路径 allowlist 宣称为可靠“只读”策略。

因此第二阶段产品契约应更诚实：

- `exposeDsh=false` 默认；
- 开启前显示阻断式确认；
- 明确“被配对设备可以调用 Agent、读写工作区并执行命令”；
- 首版把 DSH 视为 full-control remote surface；
- Gateway 只做身份/session/来源/速率与协议边界，不虚构尚未证明的 RPC 沙箱。

---

## 5. 浏览器与局域网现实约束

### 5.1 HTTP 与安全上下文

以局域网 IP 访问：

```text
http://192.168.x.x:<port>
```

不属于浏览器 Secure Context。只有 HTTPS、localhost/loopback 等被视为 potentially trustworthy。直接使用私有 IP 的 HTTP 因此可能无法使用部分仅限安全上下文的浏览器 API；Portal 不应依赖 Service Worker、强制 WebCrypto、Secure Cookie 或只在 HTTPS 可用的 Clipboard API。

### 5.2 Cookie 限制

RFC 6265 明确：

- Cookie 不按端口隔离；同一 host 的不同端口共享 Cookie 命名空间；
- `Secure` Cookie 只在安全信道发送；LAN HTTP 无法使用；
- 明文 HTTP 下 Cookie 和 Set-Cookie 可被窃听或篡改。

因此三端口方案必须：

- 每个 listener 使用不同 Cookie 名：Portal / Kimi / DSH；
- Gateway 拦截上游对这些保留 Cookie 名的 `Set-Cookie`；
- Cookie 为 host-only、HttpOnly、SameSite=Strict、Path=/；
- Session 仅在内存中有效，Gateway 停止或网络切换即失效；
- 不声称能抵御同网段主动攻击者。

### 5.3 为什么第一版不做自签 HTTPS

浏览器对自签证书会显示高风险警告，iOS/iPadOS 上的证书导入和信任流程不适合普通用户。LocalSend 的 browser fallback 也选择 HTTP，理由是浏览器拒绝自签证书。对于“无需在手机安装应用”的 P0，HTTP + 明确可信网络前提比自签 HTTPS 更可用。

未来要获得真正 HTTPS，应接入：

- Tailscale/tsnet；
- 用户受信任的本地 CA；
- 企业 MDM 证书；
- 公网域名与 ACME；
- 或自有云中继。

这些不属于第一、二阶段。

### 5.4 网络隔离

以下环境即使 Gateway 正常也可能无法连接：

- 访客 Wi-Fi；
- AP/client isolation；
- 企业 VLAN ACL；
- 酒店、机场、咖啡店网络；
- 手机使用蜂窝数据；
- 手机和电脑在不同子网且路由被禁；
- 主机防火墙没有入站例外。

产品必须提供具体错误引导，不能只显示“连接失败”。

---

## 6. Windows 与 macOS 平台约束

### 6.1 Windows Firewall

Windows Firewall 默认阻断未匹配规则的入站流量。Microsoft 推荐：

- 保持默认 inbound block；
- 私有网络共享应用只在 Private profile 启用规则；
- remote address 限制为 Local Subnet；
- 规则尽量绑定具体 program + TCP port range；
- 不要在 Public profile 默认放开；
- 依赖运行时自动弹窗可能因用户取消、无管理员权限或通知关闭而形成 block rule。

因此正式安装版的最佳体验不是运行 `netsh` 临时改规则，而是在 NSIS/MSI 安装阶段评估并创建：

```text
Program = kickside-lan-gateway.exe
Protocol = TCP
Local ports = 43100-43199（或最终受控范围）
Remote addresses = LocalSubnet
Profiles = Private（Domain 是否启用由企业策略决定）
Public = disabled
```

P0 开发版可以依靠系统提示并提供诊断；发布级 G3 应覆盖 installer rule 的创建、升级保留、卸载清理与用户手工 block 情况。

### 6.2 macOS

macOS 入站访问涉及应用签名、系统防火墙与嵌套 sidecar。正式发布应确保：

- sidecar 被包含在 app code signature 中；
- Developer ID、notarization、stapling 通过；
- 第一次局域网入站的系统提示可理解；
- App Quit / updater 先关闭 Gateway listener 与连接；
- 真实 iPhone Safari / macOS Safari 验证。

KickSide 当前部分版本允许未签名例外，但 LAN Gateway 正式发布不应把未签名 sidecar 的防火墙体验当成生产结论。

### 6.3 网卡选择

默认绑定 `0.0.0.0` 会同时暴露 Wi-Fi、Ethernet、VPN、Tailscale、Docker、虚拟机与热点网卡。Gateway 应只绑定用户选中的具体 RFC1918 IPv4，并默认限制来源为该接口当前子网。

P0 过滤规则：

- interface up；
- 非 loopback；
- global unicast；
- RFC1918：`10/8`、`172.16/12`、`192.168/16`；
- 排除 `169.254/16` link-local；
- 尽量排除 VPN/TUN/TAP、Docker、Hyper-V、VMware、Parallels 等虚拟接口；
- 多个候选时由用户选择，不做静默猜测；
- P0 仅 IPv4，IPv6 与 mDNS 延后。

网络地址变化后 P0 应立即停止共享并要求重新开启，而不是自动切到另一个网络。

---

## 7. 相关开源项目对照

### 7.1 Tauri v2 Sidecar

Tauri 官方支持 `externalBin` 打包任意语言二进制，并要求每个目标架构存在 `-$TARGET_TRIPLE` 文件。KickSide 已经按这一模式打包 `kimi-im-bridge`，因此新增 `kickside-lan-gateway` 是官方支持路径。

**可借鉴**：独立进程、目标三元组、Rust 侧生命周期。

**不应照搬**：让前端 JavaScript直接拥有 sidecar spawn 权限；Gateway 应只由 Rust manager 控制。

### 7.2 LocalSend

LocalSend 协议展示了普通用户 LAN 产品的几个关键经验：

- 不依赖外部服务器；
- 多种发现方式，因为 multicast 可能失败；
- PIN、限流和可读错误码；
- browser fallback 使用 HTTP；
- AP isolation、防火墙是高频故障。

**可借鉴**：QR/PIN、明确的 LAN 限制、错误引导。

**不在 P0 采用**：UDP multicast 自动发现；QR + IP 已足够，mDNS/发现会扩大权限和跨平台测试面。

### 7.3 code-server

code-server 官方强调：带终端的开发环境若无认证和加密被暴露，攻击者可以接管机器；默认监听 localhost，并要求 WebSocket proxy 正常工作。其密码登录还有明确速率限制。

**可借鉴**：loopback upstream、认证、速率限制、WebSocket G3。

**不能直接复用**：code-server 的单一 password 模型；KickSide 需要 QR 一次性配对和本地 Session。

### 7.4 oauth2-proxy / Caddy

这些项目证明“认证代理 + upstream”是成熟模式，Caddy 也原生支持 WebSocket 与 header rewrite。

**未选择原因**：

- OAuth/OIDC 要注册 provider、redirect URI 和互联网账户，违背局域网零前置目标；
- 嵌入 Caddy 增加独立配置语言、证书与进程面；
- KickSide 仍需要自己的 Runtime status、配对、设备撤销和路由策略，不能仅靠通用代理完成。

### 7.5 KDE Connect / Syncthing

它们采用设备级配对、证书/TLS和长期身份，安全性高于 browser-only HTTP。

**未选择原因**：需要手机端原生客户端或证书信任流程，不满足“手机浏览器扫码即用”的第一阶段目标。其设计可作为未来持久设备信任与端到端 TLS 的参考。

### 7.6 Tailscale

Tailscale/tsnet 仍是未来外网传输的优选，但不是第一、二阶段前置。最重要的架构价值是：如果 LAN Gateway 的认证、路由和 Runtime 适配独立于网络 listener，后续可以让 Tailscale 只替换传输入口，而无需重新设计 Kimi/DSH 安全策略。

---

## 8. 方案比较

| 方案 | 实现成本 | Kimi | DSH | 鉴权统一 | 隔离 | 后续外网复用 | 结论 |
|---|---:|---:|---:|---:|---:|---:|---|
| A. 两个 Runtime 直接 `0.0.0.0` | 低 | 可但需重审 | CLI 明确拒绝 | 差 | 差 | 差 | 淘汰 |
| B. Tauri/Rust 主进程内代理 | 中高 | 可 | 可 | 好 | 中；代理崩溃影响 App | 好 | 不优先 |
| C. 独立 Go LAN Gateway sidecar | 中 | 可 | 可 | 好 | 好 | 好 | **选定** |
| D. 内嵌/调用 Caddy、Nginx | 中 | 可 | 可 | 仍需自研 | 好 | 中 | 过重 |
| E. 先做 Tailscale Serve/tsnet | 高 | 可 | 可 | 好 | 好 | 最好 | 未来阶段 |

### 8.1 选定方案的决策理由

1. 只有 Gateway 能同时支持 Kimi 与 DSH，而不改变上游 loopback 设计。
2. Go sidecar 路线在 KickSide 中已有一次事实证明。
3. 网络服务器与桌面主进程隔离，崩溃和安全问题爆炸半径更小。
4. `net/http` 对 HTTP、stream、WebSocket upgrade 与 shutdown 更成熟。
5. Gateway 可成为未来 Tailscale/VPN/Remote Portal 的唯一入口。
6. 通过独立 app 目录避免把旧 `workspace_proxy` 变成无法治理的混合模块。

---

## 9. 推荐产品与网络拓扑

### 9.1 端口模型

```text
http://192.168.1.23:43100  KickSide Portal / 配对
http://192.168.1.23:43101  Kimi Code proxy
http://192.168.1.23:43102  DSH proxy
```

Gateway 从受控范围内分配三端口；实际端口只存在于运行状态。三端口优于 `/kimi`、`/dsh` 子路径，因为两套 SPA 都依赖根路径、固定 `/api` 与 WebSocket。

### 9.2 配对模型

```text
Desktop Control Center
   └─ 生成 256-bit one-time pairing secret
      └─ QR: http://IP:PORT/_kickside/pair#pair=<secret>

Browser
   ├─ fragment 不进入首个 HTTP 请求或 access log
   ├─ pairing page 读取 fragment
   ├─ POST secret 到同源 pairing endpoint
   └─ Gateway 签发 portal HttpOnly session

Portal
   ├─ 请求 Kimi one-time service ticket
   └─ 请求 DSH one-time service ticket

Service bootstrap
   ├─ /_kickside/connect#ticket=<ticket>
   ├─ ticket 单次、短时、绑定 client session/service/IP
   ├─ 签发各自 service cookie
   └─ 跳转到 upstream SPA 根路径
```

不同 listener 使用不同 Cookie 名，避免端口共享命名空间导致互相覆盖。

### 9.3 Session 生命周期

第一、二阶段建议：

- session 仅内存保存；
- Gateway stop、KickSide exit、网络切换全部失效；
- absolute TTL 8h；
- idle TTL 60min；
- active WebSocket/HTTP 会更新 last seen；
- Control Center 可逐个撤销或全部撤销；
- 不做“永久信任此设备”。

这是可逆、可验证、最小化持久秘密的第一版。

---

## 10. 威胁模型

### 10.1 需要保护的资产

- Kimi/DSH 会话与消息；
- 工作区源码和文件；
- Kimi bearer token；
- 模型 API key、Provider 配置；
- 本机 shell、PTY 与文件系统；
- Gateway pairing/session secret；
- KickSide Runtime 生命周期控制。

### 10.2 信任前提

第一、二阶段只在以下前提成立：

1. 用户明确开启功能；
2. 当前网络是用户信任的家庭或办公网络；
3. 访问设备由用户控制；
4. 路由器与同网段设备不是主动攻击者；
5. 不在公共 Wi-Fi 启用；
6. KickSide、Kimi Code 与 DSH 上游包本身被信任。

### 10.3 主要威胁与缓解

| 威胁 | 缓解 | 剩余风险 |
|---|---|---|
| 同网段未授权设备发现端口 | QR/256-bit secret、短 PIN、限流、默认关闭 | 端口存在可被扫描 |
| DNS rebinding / cross-site 请求 | exact Host allowlist、Origin equality、拒绝 cross-site Fetch Metadata、SameSite Strict | 旧浏览器标记缺失时仍依赖 Host |
| Secret 出现在 URL 日志 | 使用 fragment；日志永不记录 query/fragment | HTTP POST 仍可被同网段窃听 |
| Cookie 窃听 | 短 TTL、内存 Session、网络切换失效 | 无 TLS 时无法根除 |
| 上游 header spoofing | 清除 Forwarded/X-Forwarded/X-Real-IP/Proxy-*，Gateway自己生成 request id | upstream 仍信任 Gateway |
| 未知 upstream redirect | Location 只允许 loopback target 或改写为当前外部 authority | 上游绝对外链需系统浏览器处理 |
| Kimi PTY/shutdown 暴露 | 默认路由拒绝；显式高级开关 | Agent 工具仍可执行命令 |
| DSH 无认证 | Gateway Session；默认关闭；阻断式确认 | 配对用户拥有 full control |
| Go ReverseProxy/标准库漏洞 | Go >=1.26.6；govulncheck gate | 未来新漏洞需持续升级 |
| Gateway 崩溃后残留 listener | owned child、shutdown first、process tree kill、端口释放检查 | OS 极端故障需重启处理 |
| 网络切换到公共网络 | 地址/接口变化立即停止，不自动重绑 | OS 网络分类并非所有平台可靠 |
| 日志泄密 | 无 access body/header；URL/query 脱敏；统一 redactor | 源 IP/UA 仍是本地隐私数据 |

### 10.4 明确不能宣称的安全属性

- 不是端到端加密；
- 不是企业零信任；
- 不是公网可用；
- 不是多用户权限系统；
- 不是只读模式；
- 不能抵御恶意路由器、ARP spoofing 或同网段 MITM；
- 不能保证所有公司网络允许终端互访。

---

## 11. 分阶段边界

### 第一阶段：Kimi Code LAN Access

范围：

- Gateway foundation；
- 网卡选择与 exact bind；
- Portal + QR/手动码；
- 短期 Session、设备列表与撤销；
- Kimi HTTP/WS proxy；
- Kimi official token bootstrap；
- 高风险路由默认拒绝；
- Windows/macOS 防火墙诊断；
- Control Center 一键开关；
- iOS Safari/Android Chrome/桌面浏览器 G3。

不含：DSH、持久设备信任、mDNS、HTTPS、外网。

### 第二阶段：DSH LAN Access

在第一阶段验证通过后增加：

- `exposeDsh` 设置，默认 false；
- 明确 full-control 风险确认；
- DSH HTTP `/api/<method>` proxy；
- `/api/events.mux` 与 `/api/events.host` WebSocket；
- DSH runtime 状态与 Gateway target 原子更新；
- 多设备/多 pane 共享单一 DSH backend；
- DSH `rc.6` 固定 pin 的完整 E2E；
- upstream `rc.7` 作为观察项，不改变 pin。

---

## 12. 风险登记

| ID | 风险 | 概率 | 影响 | 处理 |
|---|---|---:|---:|---|
| R-LAN-01 | Kimi/DSH Web UI 在 HTTP 私有 IP 下依赖 Secure Context API | 中 | 高 | M0 真机 Spike；发现硬依赖则改为 HTTPS 传输阶段，不能绕过 |
| R-LAN-02 | iOS Safari Cookie/WS 行为与桌面不同 | 中 | 高 | 独立 G3；service-specific cookie 与 ticket 流程 |
| R-LAN-03 | Windows Firewall 阻断 sidecar | 高 | 高 | Private/LocalSubnet installer rule + 诊断 + 公共网络拒绝 |
| R-LAN-04 | macOS unsigned sidecar 防火墙体验不可控 | 中 | 高 | 正式发布要求签名/公证；未签名只作 developer preview |
| R-LAN-05 | 上游新增高风险 Kimi API 未被 deny list 覆盖 | 中 | 高 | OpenAPI route inventory snapshot；升级时强制 diff/review |
| R-LAN-06 | DSH generic RPC 难以细粒度过滤 | 高 | 高 | 默认关闭、full-control 文案；不宣称 RPC sandbox |
| R-LAN-07 | ReverseProxy header/upgrade 实现不完整 | 中 | 高 | patched Go、contract tests、真实 WS/file/range E2E |
| R-LAN-08 | 网络切换后旧 IP/Session 残留 | 中 | 高 | interface watcher；变化即 stop/revoke，不自动重绑 |
| R-LAN-09 | Cookie 跨端口命名冲突 | 中 | 中 | 三个保留 cookie 名、上游 Set-Cookie 过滤、每服务 ticket |
| R-LAN-10 | HTTP 明文造成误导 | 高 | 高 | 产品文案与阻断式公共网络警告；不使用“安全远程访问”绝对表述 |
| R-LAN-11 | 第二个 sidecar 增加发布复杂度 | 中 | 中 | 复用现有 build/manifest/gates；独立 binary smoke |
| R-LAN-12 | DSH rc.7 与 KickSide rc.6 协议漂移 | 高 | 中 | pin 驱动测试；latest 只作观察 lane |

---

## 13. M0 待验证问题

| ID | 问题 | 验证方法 | Go / No-Go |
|---|---|---|---|
| A-LAN-01 | Kimi Web 在 `http://RFC1918-IP` 顶层页面是否完整工作 | 原生 Gateway spike；消息、上传、WS、审批、下载 | 核心流程失败且无小范围修复 → P0 No-Go |
| A-LAN-02 | DSH rc.6 经代理的两条 WS 与 `/api/<method>` 是否稳定 | 真实 rc.6、完整会话与 Bash/approval | 两条 WS任一不可代理 → P1 No-Go |
| A-LAN-03 | iOS Safari 是否接受三端口 service ticket/cookie 流程 | iPhone 真机扫码、切端口、后台恢复 | cookie/WS 无稳定路径 → 重设认证拓扑 |
| A-LAN-04 | Android Chrome 同流程 | Android 真机 | 同上 |
| A-LAN-05 | Go ReverseProxy 对 Kimi WS subprotocol、Range、multipart | fake upstream + real Kimi | 任一核心能力失败需在 M0修复 |
| A-LAN-06 | Windows installer firewall rule 双安装器如何收口 | NSIS/MSI clean VM | 无可靠规则/回滚 → beta 仅手工授权并明确限制 |
| A-LAN-07 | macOS signed nested sidecar 的 firewall prompt | Developer ID build | 无签名证据不得宣称生产发布 |
| A-LAN-08 | 网络切换/睡眠唤醒时 listener 与 session | Wi-Fi A→B、sleep/wake | 旧 listener/session 残留 → No-Go |
| A-LAN-09 | Kimi route deny 是否破坏默认移动 UI | path-level fault injection | 必要 UI 路由被误伤则调整 policy，但不得放开 PTY/shutdown |
| A-LAN-10 | Gateway 三端口 Cookie 保留名是否会被上游覆盖 | malicious Set-Cookie fixture | 可覆盖且无法拦截 → 改为独立 host/单端口 auth bootstrap |

---

## 14. 最终结论

第一、二阶段是可行的，且与 KickSide 现有产品路线一致。真正的工程核心不是“打开一个端口”，而是建立一个稳定的 **Remote Surface Boundary**：

```text
Runtime authority 仍为 loopback
        +
Gateway 承担 LAN reachability
        +
Pairing/Session 承担用户进入门槛
        +
Route policy 承担防御纵深
        +
G3 真机矩阵证明浏览器与防火墙行为
```

在此边界下：第一阶段的 Kimi LAN Access 可以作为独立 Beta 发布；第二阶段的 DSH LAN Access 必须在第一阶段 Gateway 与真机证据稳定后追加，并默认关闭。未来 Tailscale、VPN 或 Remote Portal 只需接入 Gateway，不应再次直接暴露两个 Runtime。

---

## 15. 主要来源

### KickSide

- `https://github.com/endearqb/kickside/tree/a9c916e60d1cce113c644dbb4adf51f530bb7959`
- `README.md`
- `.ai/CONSTITUTION.md`
- `AGENTS.md`
- `DESIGN.md`
- `.ai/architecture/current-state.md`
- `.ai/architecture/verification-gates.md`
- `apps/kimi-shell/src-tauri/tauri.conf.json`
- `apps/kimi-shell/scripts/build_bridge_sidecar.mjs`
- `apps/kimi-shell/src-tauri/src/backend_manager/lifecycle.rs`
- `apps/kimi-shell/src-tauri/src/backend_manager/workspace_proxy.rs`
- `apps/kimi-shell/src-tauri/src/dsh_manager.rs`
- `apps/kimi-shell/src-tauri/src/bridge_manager.rs`
- `apps/kimi-shell/src/services/dshService.ts`

### Kimi Code

- `https://github.com/MoonshotAI/kimi-code`
- `docs/zh/guides/server.md`
- `docs/zh/reference/kimi-command.md`
- `docs/zh/reference/server-api.md`
- `packages/kap-server/src/middleware/hostnames.ts`
- `packages/kap-server/src/middleware/origin.ts`
- `packages/kap-server/src/start.ts`

### DeepSeek Harness

- `https://github.com/deepseek-ai/deepseek-harness`
- `packages/bundle/web-app/src/startup.ts`
- `packages/bundle/web-app/README.zh.md`
- `packages/host/webserver/README.zh.md`
- `packages/client/connection/README.zh.md`
- `.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.zh.md`

### 相关规范与项目

- Tauri v2 Sidecar：`https://v2.tauri.app/zh-cn/develop/sidecar/`
- Go 漏洞 GO-2026-4976：`https://pkg.go.dev/vuln/GO-2026-4976`
- W3C Secure Contexts：`https://www.w3.org/TR/secure-contexts/`
- RFC 6265：`https://datatracker.ietf.org/doc/rfc6265/`
- Microsoft Windows Firewall：`https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/`
- Apple `NSAllowsLocalNetworking`：`https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking`
- LocalSend Protocol：`https://github.com/localsend/protocol`
- code-server guide：`https://github.com/coder/code-server/blob/main/docs/guide.md`
- Caddy reverse_proxy：`https://caddyserver.com/docs/caddyfile/directives/reverse_proxy`
- oauth2-proxy：`https://github.com/oauth2-proxy/oauth2-proxy`
