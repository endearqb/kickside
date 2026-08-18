# Spec · KickSide LAN Gateway（Kimi P0 + DSH P1）

> **状态：未来备选架构档案。** 当前技术规范以 `08-native-lan-spec.md` 为准；禁止按本文继续接入 sidecar、proxy、pairing 或 DSH LAN。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17 |
| 状态 | Draft technical specification；未实现 |
| 对应需求 | `02-prd.md` FR-LAN-001~025、FR-DSH-LAN-001~015、全部 NFR |
| 事实依据 | `01-research.md` |
| 基线 | KickSide `main@a9c916e60d1cce113c644dbb4adf51f530bb7959` |
| 规范关键词 | MUST / SHOULD / MAY 分别表示必须、建议、可选 |

---

## 1. 架构决策

### 1.1 总体架构

新增独立 Go sidecar：

```text
apps/kickside-lan-gateway
```

Tauri/Rust 只负责：

- 读取/保存 LAN 用户意图；
- 执行 preflight；
- 选择网络接口；
- 生成 admin token file；
- 启停和监督 sidecar；
- 向 Gateway 提交当前 Kimi/DSH target；
- 将状态投影到 React；
- 在应用退出/更新前先收口 Gateway。

Gateway 负责：

- public listener；
- Portal 静态页；
- QR pairing 协议；
- browser Session；
- HTTP / WebSocket proxy；
- Host/Origin/CSRF/限流；
- Kimi 路由策略；
- DSH full-control exposure gate；
- audit 与 runtime metrics。

Kimi Code 与 DSH 不改监听地址：

```text
Kimi Code: http://127.0.0.1:<kimiPort>
DSH:       http://127.0.0.1:<dshPort>
```

### 1.2 需要先接受的 ADR

实现前必须新增 accepted ADR，例如：

```text
.ai/decisions/2026-08-17-lan-gateway-sidecar-and-loopback-boundary.md
```

ADR 固化：

1. Gateway 是独立 Go sidecar；
2. upstream 永不绑定 LAN；
3. P0 使用可信 LAN HTTP；
4. 三端口 topology；
5. Session 仅内存；
6. Kimi 路由策略为防御纵深，不是 sandbox；
7. DSH 为 full-control、默认关闭；
8. Go toolchain 安全下限；
9. 未来 Tailscale 只作为 transport，不替代 Gateway。

### 1.3 禁止实现

以下实现视为 Spec 违规：

- 给 Kimi 加 `--host 0.0.0.0`；
- 修改 DSH CLI 绕过 `0.0.0.0` 拒绝；
- 把 LAN 逻辑塞进 `workspace_proxy.rs`；
- 让 React 直接 spawn/kill Gateway；
- 把 admin token、pair secret、session cookie 放进 argv；
- 将 remote URL/token 写入 Grid persisted state；
- 在 Public network 默认启用；
- 通过 wildcard CORS 放行；
- 首版自动信任设备跨应用重启；
- 用“只读”描述 Kimi/DSH remote surface。

---

## 2. 目录与模块布局

### 2.1 新 Go 应用

```text
apps/kickside-lan-gateway/
├─ README.md
├─ go.mod
├─ go.sum
├─ cmd/kickside-lan-gateway/
│  └─ main.go
├─ api/
│  ├─ openapi.yaml
│  └─ fixtures/
├─ internal/
│  ├─ adminapi/
│  ├─ audit/
│  ├─ auth/
│  ├─ buildinfo/
│  ├─ config/
│  ├─ gateway/
│  ├─ httpguard/
│  ├─ interfaceprobe/
│  ├─ pairing/
│  ├─ policy/
│  ├─ portal/
│  │  └─ dist/              # go:embed，或由源码构建后嵌入
│  ├─ proxy/
│  ├─ runtime/
│  ├─ session/
│  └─ shutdown/
└─ testdata/
   ├─ fake-kimi/
   ├─ fake-dsh/
   └─ certificates/         # 若无 TLS，不创建
```

职责边界：

- `adminapi` 只服务 loopback Tauri 控制面；
- `gateway` 编排 listener 与状态，不含 upstream 业务；
- `proxy` 只处理通用 HTTP/WS；
- `policy/kimi` 分类 Kimi 路由；
- `policy/dsh` 只定义 exposure/full-control 边界，不伪造完整 RPC RBAC；
- `pairing/session` 不依赖 Kimi/DSH；
- `portal` 不调用 Tauri IPC。

### 2.2 Tauri/Rust 新文件

```text
apps/kimi-shell/src-tauri/src/
├─ lan_access_manager.rs
├─ lan_gateway_client.rs
├─ lan_gateway_locator.rs       # 可选，只有运行态，不含 secret
└─ commands/
   └─ lan_access.rs
```

如果 `lan_access_manager.rs` 超过约 800 行，应按职责拆：

```text
lan_access/
├─ mod.rs
├─ lifecycle.rs
├─ preflight.rs
├─ settings.rs
└─ types.rs
```

不要提前建立通用 `RemoteAccessProvider` 抽象；第二种 transport 真正出现后再评估。

### 2.3 React/TypeScript 新文件

```text
apps/kimi-shell/src/
├─ services/lanAccessService.ts
├─ features/control-center/LanAccessSettingsPanel.tsx
├─ features/control-center/LanAccessPairingDialog.tsx
├─ features/control-center/LanAccessDeviceList.tsx
└─ app/useLanAccessController.ts
```

LAN 状态应使用独立 controller/store，不把全部动作继续堆进 `ControlCenterView.tsx`。

### 2.4 构建脚本

将现有桥接脚本中纯 build mapping 提取为薄 utility：

```text
apps/kimi-shell/scripts/go_sidecar_build_utils.mjs
apps/kimi-shell/scripts/build_bridge_sidecar.mjs
apps/kimi-shell/scripts/build_lan_gateway_sidecar.mjs
```

只共享：

- Tauri target → GOOS/GOARCH；
- output target-triple 命名；
- `CGO_ENABLED=0`；
- `-trimpath` / release ldflags；
- host-target `--version` smoke。

Bridge 与 Gateway 生命周期代码不抽象到同一 manager。

---

## 3. Go 版本与依赖

### 3.1 Toolchain

Gateway MUST 使用：

```text
Go >= 1.26.6
```

建议 `go.mod`：

```go
module github.com/endearqb/kickside/apps/kickside-lan-gateway

go 1.26.6
```

CI MUST 验证实际 `go env GOVERSION` 不低于 1.26.6，并运行：

```bash
go vet ./...
go test ./...
go test -race ./...
govulncheck ./...
```

原因：除 `GO-2026-4976 / CVE-2026-39825` 外，M0 在 Go 1.26.5 上验证到 GO-2026-6090、GO-2026-6089、GO-2026-5972 与 GO-2026-5026 的可达标准库路径；这些问题在 Go 1.26.6 修复。

### 3.2 依赖策略

优先标准库：

- `net/http`
- `net/http/httputil`
- `net/netip`
- `crypto/rand`
- `crypto/sha256`
- `crypto/subtle`
- `encoding/json`
- `embed`
- `slog`

允许的窄依赖候选：

- QR 生成库，仅用于 Desktop/Portal QR SVG/PNG；必须固定版本、检查许可证和漏洞。

不引入：

- Caddy；
- oauth2-proxy；
- SQLite；
- 通用 IAM/OIDC；
- Web framework；
- 持久 Session store。

---

## 4. 运行拓扑

### 4.1 Listener

一个 Gateway process 管理四类 listener：

```text
Admin  127.0.0.1:<adminPort>             必须
Portal <selectedIPv4>:<portalPort>         必须
Kimi   <selectedIPv4>:<kimiPublicPort>     P0 必须
DSH    <selectedIPv4>:<dshPublicPort>      P1；listener 可常驻但未授权时返回 404，建议仅 expose 时监听
```

推荐只在 DSH exposure 开启时创建 DSH listener，关闭时直接 close，缩小表面。

### 4.2 默认端口范围

```text
43100-43199/TCP
```

分配算法：

1. 从 `preferredBasePort`（默认 43100）开始；
2. 尝试连续三端口 `base, base+1, base+2`；
3. 任一不可绑定则 `base += 3`；
4. 只在 43100-43199 内；
5. 绑定必须由 Gateway 自身一次完成，避免 TOCTOU；
6. 返回实际 triplet；
7. actual ports 只在 runtime status，不持久化为 authority。

Admin port 从 loopback OS ephemeral port 获取，或由 Rust 预分配；不进入 public range。

### 4.3 为什么不用子路径

以下 topology 不属于 P0：

```text
http://IP:43100/kimi
http://IP:43100/dsh
```

原因：Kimi/DSH 都使用根静态资源、根 `/api`、固定 WS 和 SPA fallback。除非上游明确支持 base path，否则不进行全量 HTML/JS/CSS path rewriting。

---

## 5. 网络接口 Preflight

### 5.1 Gateway probe subcommand

Sidecar 提供：

```bash
kickside-lan-gateway probe --json
kickside-lan-gateway --version
```

`probe` 不启动 public listener，不需要 secret，输出有界 JSON：

```json
{
  "version": "0.1.0",
  "interfaces": [
    {
      "id": "stable-interface-id",
      "name": "Wi-Fi",
      "displayName": "Wi-Fi",
      "address": "192.168.1.23",
      "prefixLength": 24,
      "network": "192.168.1.0/24",
      "kind": "wifi",
      "isPrivate": true,
      "isVirtual": false,
      "isPreferred": true
    }
  ],
  "platform": {
    "os": "windows",
    "networkProfile": "private",
    "firewallHint": "unknown"
  },
  "issues": []
}
```

### 5.2 过滤算法

MUST：

1. interface is up；
2. 地址是 IPv4；
3. 非 loopback；
4. 非 unspecified/multicast；
5. 非 `169.254.0.0/16`；
6. 只选 RFC1918；
7. prefix 合法；
8. 同一 interface 多地址时逐项返回。

SHOULD 识别并默认隐藏：

- Tailscale/WireGuard/OpenVPN；
- tun/tap/utun；
- Docker/Podman；
- Hyper-V/WSL；
- VMware/VirtualBox/Parallels；
- 手机模拟器与桥接虚拟网卡。

虚拟判断只用于排序/隐藏，不能作为唯一安全判断；技术详情允许显示。

### 5.3 网络分类

Windows：

- `private`：允许正常开启；
- `domain`：允许，但提示可能受组织策略管理；
- `public`：默认阻断，需 developer override；
- `unknown`：默认阻断。

macOS：没有等价且稳定的用户可见 profile API。P0 依赖：

- RFC1918；
- 用户显式选择；
- 每次启动不自动恢复；
- 必要警告。

### 5.4 来源子网限制

每个 public listener MUST 在接受请求后校验 `RemoteAddr`：

```text
sourceIP ∈ selected interface CIDR
```

默认 `sameSubnetOnly=true`，P0 不提供关闭开关。忽略客户端提供的 `X-Forwarded-For`。

---

## 6. 设置模型

### 6.1 Schema 升级

`CURRENT_SETTINGS_SCHEMA_VERSION`：

```text
13 → 14
```

新增：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LanAccessSettings {
    pub configured: bool,
    pub preferred_interface_id: Option<String>,
    pub preferred_base_port: u16,
    pub expose_kimi: bool,
    pub expose_dsh: bool,
}
```

默认：

```rust
LanAccessSettings {
    configured: false,
    preferred_interface_id: None,
    preferred_base_port: 43100,
    expose_kimi: true,
    expose_dsh: false,
}
```

### 6.2 `configured` 语义

`configured=true` 只表示用户已完成过 LAN 设置，用于 UI；不表示“下次启动自动共享”。每个 app process 启动时 runtime state 都是 stopped，必须显式点击开启。不得持久化 `runtime_running=true`。

退出停止是安全不变量，不是用户偏好：App Quit、updater 与 parent-death 都必须停止 Gateway，因此不提供 `stop_on_exit=false`。

### 6.3 不得持久化

- selected current IP；
- actual ports；
- Gateway PID/admin port；
- pair secret/manual code；
- browser session；
- service ticket；
- Cookie；
- Kimi token/tokenized URL；
- DSH URL；
- connected device IP/UA。

---

## 7. Rust 运行状态与状态机

### 7.1 状态类型

```rust
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LanAccessState {
    Stopped,
    Starting,
    Running,
    Degraded,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanAccessStatus {
    pub state: LanAccessState,
    pub gateway_version: Option<String>,
    pub interface: Option<LanInterfaceView>,
    pub portal_url: Option<String>,          // 无 secret
    pub kimi_url: Option<String>,            // 无 #token / ticket
    pub dsh_url: Option<String>,
    pub ports: Option<LanPortTriplet>,
    pub expose_kimi: bool,
    pub expose_dsh: bool,
    pub connected_clients: Vec<LanClientView>,
    pub pairing: Option<LanPairingView>,     // 只给显式 pairing dialog；不得进普通诊断
    pub last_error: Option<LanErrorView>,
    pub started_at_ms: Option<u64>,
}
```

`portal_url` 只能是：

```text
http://192.168.1.23:43100
```

不能含 `#pair`。

### 7.2 状态转换

```text
Stopped
  └─ enable → Starting
Starting
  ├─ ready → Running
  ├─ partial health → Degraded
  └─ failure → Error
Running
  ├─ target unavailable → Degraded
  ├─ interface change → Stopping → Stopped(E-LAN-010)
  ├─ user stop → Stopping → Stopped
  └─ child exit → Error
Degraded
  ├─ recover → Running
  ├─ user stop → Stopping → Stopped
  └─ child exit → Error
Error
  ├─ retry → Starting
  └─ stop/reset → Stopped
```

`Starting/Stopping` 期间生命周期操作单飞；重复 enable/disable 幂等。

### 7.3 AppState

新增：

```rust
pub struct LanGatewayProcessState {
    pub generation: u64,
    pub child: Option<Child>,
    pub process_group_id: Option<i32>,
    pub state: LanAccessState,
    pub admin_origin: Option<String>,
    pub admin_token_file: Option<PathBuf>,
    pub selected_interface: Option<LanInterface>,
    pub public_ports: Option<LanPortTriplet>,
    pub last_error: Option<String>,
}
```

以及：

```rust
pub lan_gateway: Mutex<LanGatewayProcessState>,
pub lan_gateway_lifecycle_operation: Mutex<()>,
```

不在状态中保存 admin token 明文；client 每次从 token file 读取。

---

## 8. Sidecar 启动与 Admin API

### 8.1 启动参数与环境变量

命令：

```text
kickside-lan-gateway serve
```

argv 只含静态 `serve`。动态值通过环境变量/文件：

```text
KICKSIDE_LAN_ADMIN_HOST=127.0.0.1
KICKSIDE_LAN_ADMIN_PORT=<port>
KICKSIDE_LAN_ADMIN_TOKEN_FILE=<path>
KICKSIDE_LAN_LOG_FILE=<path>
KICKSIDE_LAN_STATE_DIR=<path>
KICKSIDE_LAN_PARENT_PID=<pid>
```

`ADMIN_TOKEN_FILE`：

- 32 bytes random base64url；
- 创建权限 Unix 0600；
- Windows ACL 仅当前用户；
- child ready 后仍保留供 Rust client 使用；
- stop 后删除；
- 日志只记录 path 的 basename 或 redacted path。

### 8.2 Admin API authority

```text
http://127.0.0.1:<adminPort>/v1/*
```

每个请求：

```http
Authorization: Bearer <admin-token>
Content-Type: application/json
X-KickSide-Request-Id: <ULID/UUID>
```

未授权返回 401；10 次失败/60s 后 rate-limit。

### 8.3 Canonical contract

权威契约：

```text
apps/kickside-lan-gateway/api/openapi.yaml
```

Go handler 与 Rust client 都只映射该契约。每次接口变化必须：

- 更新 OpenAPI；
- 更新 fixtures；
- Go contract test；
- Rust fixture deserialization test；
- command type test；
- 若语义已发布，按 additive-only 规则处理。

### 8.4 Admin endpoints

#### `GET /v1/health`

免业务配置，仍需 admin auth：

```json
{
  "ok": true,
  "data": {
    "version": "0.1.0",
    "state": "idle",
    "uptimeMs": 1200
  },
  "requestId": "..."
}
```

#### `POST /v1/start`

```json
{
  "interface": {
    "id": "...",
    "address": "192.168.1.23",
    "prefixLength": 24
  },
  "preferredBasePort": 43100,
  "services": {
    "kimi": {
      "enabled": true,
      "target": "http://127.0.0.1:58627",
      "tokenFile": "<path>",
      "policy": {
        "allowRemoteTerminal": false,
        "allowHostFilesystem": false,
        "allowRuntimeShutdown": false
      }
    },
    "dsh": {
      "enabled": false,
      "target": null,
      "fullControlConfirmed": false
    }
  }
}
```

校验：

- interface/address 必须匹配 probe；
- target 必须 loopback HTTP + valid port；
- tokenFile 必须存在、普通文件、可读；
- dsh enabled 时确认 flag true；
- preferred base 在 range；
- 已 running 时返回 409，调用 update。

#### `POST /v1/stop`

- 停止 public listeners；
- revoke pairing/session/tickets；
- close WS；
- 返回后保证端口不再 accept；
- sidecar process可保持 idle 或退出。推荐 process 退出，Rust生命周期更清晰。

#### `PUT /v1/services/kimi`

原子更新 Kimi target/tokenFile/policy。target 变化：

- 新请求走新 target；
- 旧 WS 发送 close/reconnect；
- 旧 target 不再使用；
- portal status 更新。

#### `PUT /v1/services/dsh`

原子设置 enabled/target/fullControlConfirmed。

#### `POST /v1/pairing/rotate`

返回 pair view：

```json
{
  "pairUrl": "http://192.168.1.23:43100/_kickside/pair#pair=<secret>",
  "manualCode": "48273195",
  "expiresAtMs": 1786972200000
}
```

该 endpoint 是唯一允许明文返回 pair secret 的 admin call。Rust 仅在显式 QR dialog 内持有，关闭 dialog 即清空前端 state。

#### `GET /v1/clients`

返回已配对 Session 摘要，不含 cookie/token。

#### `DELETE /v1/clients/{id}`

撤销该 client 的 portal/kimi/dsh Sessions 与 tickets，关闭 active WS。

#### `DELETE /v1/clients`

全部撤销。

#### `GET /v1/status`

返回 gateway/listener/services/metrics/errors。

#### `GET /v1/logs/tail?lines=80`

最多 500 行，已脱敏。

---

## 9. Public Gateway Guard

所有 Portal/Kimi/DSH 请求先经过统一 guard。

### 9.1 Host

允许值仅为：

```text
<selected-ip>:<owned-port>
```

按当前 listener 精确匹配。拒绝：

- 其他 host；
- DNS 名；
- 缺失 Host；
- 端口不匹配；
- X-Forwarded-Host 试图覆盖。

返回：

```text
403 E-LAN-HOST-001
```

### 9.2 Remote IP

使用 socket `RemoteAddr`，必须在 selected CIDR；不解析 forwarded headers。

### 9.3 Origin 与 Fetch Metadata

规则：

1. `Sec-Fetch-Site: cross-site` → 403；
2. 有 Origin：必须与 `http://<selected-ip>:<listener-port>` 完全一致；
3. `Origin: null` 对 state-changing request 拒绝；
4. 无 Origin 的 top-level GET 可允许；
5. reserved Gateway POST 必须带 `Content-Type: application/json`；
6. 不应答 wildcard CORS；
7. OPTIONS 只为 Gateway 自身同源流程返回 204。

### 9.4 Method 与 Body

- Portal reserved API：GET/POST/DELETE allowlist；
- header 最大 64KiB；
- pair/session JSON body 最大 64KiB；
- malformed body 400，不 panic；
- request timeout、idle timeout、read-header timeout 明确配置。

### 9.5 安全响应头

Gateway 自有 Portal/Pair 页面：

```http
Cache-Control: no-store
Pragma: no-cache
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

代理 upstream 页面不能强加会破坏它们的 CSP；只添加不冲突的 `Referrer-Policy`、`X-Content-Type-Options`，并保留 upstream CSP。

---

## 10. Pairing 与 Session 协议

### 10.1 Secret

QR pairing secret：

- `crypto/rand` 32 bytes；
- base64url no padding；
- hash 后存在内存；
- TTL 5min；
- 单次成功即失效；
- rotate 会立刻失效旧 secret。

手动码：

- 8 位独立随机数字；
- 不从 QR secret 截断；
- hash 存内存；
- TTL 同 QR；
- per-IP 最多 5 次失败，随后该 pairing generation 对该 IP 锁定；
- global 50 attempts/min。

### 10.2 Pair URL

```text
http://<IP>:<portalPort>/_kickside/pair#pair=<secret>
```

服务器首个 GET 看不到 fragment。Pair 页面 JS：

1. 读取 `location.hash`；
2. `history.replaceState` 清理地址栏 fragment；
3. POST `/_kickside/api/pair`；
4. 成功后跳转 `/`；
5. secret 从 JS变量置空；
6. 不写 localStorage/sessionStorage/indexedDB。

### 10.3 Portal Session

Cookie：

```text
Name: ks_portal_session
Host-only
Path=/
HttpOnly
SameSite=Strict
Secure=false（仅因 HTTP；文档必须说明限制）
Max-Age=28800（8h）
```

Server-side：

```go
type Session struct {
    IDHash          [32]byte
    ClientID        string
    Scope           ScopePortal | ScopeKimi | ScopeDsh
    SourceIP        netip.Addr
    UserAgentFamily string
    CreatedAt       time.Time
    LastSeenAt      time.Time
    ExpiresAt       time.Time
    IdleExpiresAt   time.Time
    Revoked         bool
}
```

存 hash，不存明文 cookie。验证使用 constant-time compare 或 map keyed by hash。

### 10.4 Service Ticket

Portal authenticated endpoint：

```text
POST /_kickside/api/tickets/kimi
POST /_kickside/api/tickets/dsh
```

返回：

```json
{
  "connectUrl": "http://IP:43101/_kickside/connect#ticket=<opaque>"
}
```

Ticket：

- 32 bytes random；
- 60s；
- single-use；
- 绑定 `portalSessionID + clientID + sourceIP + service`；
- DSH ticket 只在 exposure enabled 且 Runtime available 时签发；
- 不进 access log。

### 10.5 Service Session

Cookie 名：

```text
ks_kimi_session
ks_dsh_session
```

属性与 Portal 相同，但 scope 独立。

Service connect 页面：

```text
/_kickside/connect#ticket=<ticket>
```

JS POST 同源 ticket，Gateway set service cookie。

Kimi 成功响应返回内存 bootstrap target：

```json
{
  "next": "/?kimi_onboarded=1#token=<current-kimi-token>"
}
```

页面使用 `location.replace(next)`。该 JSON：

- `Cache-Control: no-store`；
- 不记录 body；
- token 从 Kimi token file 实时读取；
- 读取失败返回 E-LAN-008；
- 不在 Gateway runtime state 长期缓存明文。

DSH：

```json
{ "next": "/" }
```

### 10.6 Cookie 保留名防护

Proxy response 遇到 upstream：

```text
Set-Cookie: ks_portal_session=...
Set-Cookie: ks_kimi_session=...
Set-Cookie: ks_dsh_session=...
```

MUST 删除。其他 upstream Cookie 原样保留，除非安全测试证明需 domain/path rewrite。

### 10.7 撤销

撤销 client 时：

- Session标记 revoked；
- 删除 pending tickets；
- active HTTP 下一请求 401；
- active WS 发送 policy close，随后断开；
- Portal刷新显示“此设备已撤销”。

---

## 11. 通用 Reverse Proxy

### 11.1 Target 校验

只接受：

```text
scheme == http
host == 127.0.0.1 或 localhost（规范化为 127.0.0.1）
port ∈ 1..65535
path == empty or /
无 userinfo/query/fragment
```

DSH/Kimi target 由 Rust 当前 owned/reused runtime 状态提供，不接受 browser 输入。

### 11.2 `httputil.ReverseProxy` 配置

使用 `Rewrite`，禁止 legacy `Director`：

```go
proxy.Rewrite = func(pr *httputil.ProxyRequest) {
    pr.SetURL(target)
    pr.Out.Host = target.Host

    removeUntrustedForwardingHeaders(pr.Out.Header)
    rewriteOriginToLoopback(pr.Out.Header, target)
    setRequestID(pr.Out.Header)
}
```

注意：不能用 query parser 做安全 allowlist 后再原样 forward；Go 版本必须已修复 GO-2026-4976。

### 11.3 Header 规则

删除入站：

```text
Forwarded
X-Forwarded-For
X-Forwarded-Host
X-Forwarded-Proto
X-Real-IP
Proxy-Authorization
Proxy-Authenticate
Via
Connection 指定的 hop-by-hop headers
```

`Authorization`：

- Kimi 原样保留，以便官方 token；
- DSH 当前无 auth，可删除客户端任意 Authorization，避免 upstream误用；
- Gateway Session 只来自 Cookie，不转给 upstream。

Cookie：

- 从 upstream request 中移除 `ks_*_session` 三个 Gateway cookie；
- 其他 Cookie 传给 upstream。

### 11.4 Origin

浏览器外部：

```text
Origin: http://192.168.1.23:43101
```

Kimi upstream：

```text
Origin: http://127.0.0.1:58627
Host:   127.0.0.1:58627
```

DSH同理。

Referer 若为当前 public authority，改写为 loopback authority；外部 Referer 可删除。

### 11.5 Response 改写

- `Location` 指向 upstream loopback authority → public service authority；
- `Location` 外部 HTTPS auth/domain 保留，但 P0 Kimi remote OAuth route 已阻断；
- 删除 Gateway reserved Cookie；
- 删除或重写 upstream `Access-Control-Allow-Origin`，避免指向 loopback；同源页面通常不需 CORS；
- 不修改响应 body；
- 不压缩/解压，除非 Location/HTML rewrite 需要；P0 不做 HTML 注入。

### 11.6 Streaming

- 不整体缓冲普通 upstream response；
- flush interval 设为 immediate 或经 M0校准；
- 关闭 proxy response buffering；
- client disconnect 取消 upstream context；
- 不把 assistant delta 写日志。

### 11.7 WebSocket

Go ReverseProxy upgrade path必须：

- 保留 `Upgrade: websocket`；
- 保留 Kimi `Sec-WebSocket-Protocol: kimi-code.bearer.*`；
- rewrite Origin；
- service cookie 在 upgrade 前验证，随后从 upstream Cookie 中移除 Gateway cookie；
- 连接计入 client activeConnections；
- revoke/stop 时主动 close；
- idle timeout 不应误杀长时间无消息的 Kimi WS，使用 ping/pong 或无限 idle + lifecycle cancellation；
- DSH 两条 WS 分别计数并在任一失败时让浏览器自己 generation 重连。

### 11.8 资源上限

初始值，M0 校准：

| 项 | Portal | Kimi | DSH |
|---|---:|---:|---:|
| Header | 32KiB | 64KiB | 64KiB |
| JSON pair/admin body | 64KiB | — | — |
| Proxy request body | — | 256MiB streaming | 192MiB / 上游约束内 |
| 并发连接/Client | 20 | 40 | 40 |
| 全局连接 | 200 | 200 | 200 |
| ReadHeaderTimeout | 5s | 10s | 10s |
| Idle HTTP | 60s | 120s | 120s |

不得通过 `io.ReadAll` 缓冲 Kimi 文件或普通 proxy body。

---

## 12. Kimi Adapter

### 12.1 Availability

Kimi service 可签 ticket 的条件：

```text
KickSide backend.state == Running
runtime_origin == http://127.0.0.1:<port>
server_token_path 可读
Gateway 对 /api/v1/healthz 探测通过
Gateway 以 bearer 对 /api/v1/auth 探测通过
```

Gateway 不自行启动 Kimi；Rust enable flow 可先调用现有 backend start/retry。

### 12.2 Token

Gateway 只在：

- Kimi connect bootstrap；
- 可选 authenticated health probe；

从 token file 读取。MUST：

- trim；
- 长度/字符有界；
- 文件 canonical；
- 不跟随越出预期 home 的 symlink（由 Rust先验证，Gateway再防御）；
- 不写日志；
- rotate 后新 bootstrap 自动读取新值。

### 12.3 Route policy

实现：

```go
type KimiPolicy struct {
    AllowRemoteTerminal    bool
    AllowHostFilesystem    bool
    AllowRuntimeShutdown   bool
}
```

#### 永久拒绝（P0 无开关）

```text
/api/v1/debug/*
任意非 /api 或静态资源之外的 Gateway reserved path 冲突
```

#### 默认拒绝，可选高级开关

**Remote terminal**：

```text
/api/v1/sessions/*/terminals
/api/v1/sessions/*/terminals/*
```

**Runtime shutdown**：

```text
POST /api/v1/shutdown
```

**Host filesystem/native UI**：

```text
GET  /api/v1/fs:browse
GET  /api/v1/fs:home
GET  /api/v1/fs:content
POST /api/v1/fs:mkdir
session fs actions open/open-in/reveal
```

#### 默认拒绝，P0 不提供开关

```text
POST/DELETE /api/v1/oauth/login
POST /api/v1/oauth/logout
Provider secret-bearing CRUD
```

Provider 路由的精确清单以当前 OpenAPI inventory fixture为准。

### 12.4 OpenAPI inventory gate

构建/测试时从 supported Kimi server fixture读取 `/openapi.json`，生成：

```text
apps/kickside-lan-gateway/internal/policy/testdata/kimi-openapi-routes.json
```

分类：

```json
{
  "method": "GET",
  "path": "/api/v1/fs:content",
  "class": "host_filesystem",
  "default": "deny"
}
```

当 Kimi upgrade canary 出现新路由：

- CI 输出 diff；
- 新路由默认 `unreviewed`；
- 写方法在 Gateway 中 fail closed；
- 读方法由安全评审决定；
- 更新 manifest 是 Kimi pin/版本兼容审查的一部分。

### 12.5 Policy deny response

对于 REST：

```json
{
  "code": 40320,
  "msg": "E-LAN-014：此操作默认不允许通过局域网访问",
  "data": { "policy": "remote_terminal" },
  "request_id": "..."
}
```

保持 Kimi envelope 风格，避免 UI 崩溃。静态/导航可用普通 403 HTML。

### 12.6 Kimi E2E 必测

1. root + onboarded query + token fragment；
2. auth/meta/config只读；
3. workspace/session list/create；
4. prompt；
5. `/api/v1/ws` server_hello/subscribe/delta；
6. approval/question；
7. upload/download；
8. session export；
9. Range/ETag；
10. WS断线 cursor/resync；
11. terminal deny；
12. shutdown deny；
13. token rotate；
14. backend restart/port change；
15. revoke active WS。

---

## 13. DSH Adapter（P1）

### 13.1 Availability

DSH service 可签 ticket：

```text
settings.exposeDsh == true
fullControlConfirmed == true（当前 Gateway generation）
DSH status ∈ {Running, Degraded}
status.url == http://127.0.0.1:<status.port>
Gateway root readiness probe 通过
KickSide pinnedVersion == expected tested pin
```

`Degraded` 可保留现有连接，但 Portal 显示警告；新的 ticket 是否允许由 M0 结果决定，默认建议 running only。

### 13.2 DSH full-control confirmation

确认不持久化为永久同意。每个 Gateway generation 首次开启 DSH 要求用户确认：

```text
开启后，已配对设备可以在当前 DSH 工作区中：
- 向 Agent 提交任务
- 读取和修改文件
- 执行 Bash 命令
- 查看会话与设置

仅在你信任的局域网和设备上开启。
```

Rust `PUT /services/dsh` 必须带：

```json
{ "fullControlConfirmed": true }
```

Gateway 不接受 browser 自己开启 DSH。

### 13.3 Protocol

Proxy paths：

```text
/api/<method>              HTTP unary/respond
/api/events.mux            WebSocket
/api/events.host           WebSocket
/*                         static/SPA fallback
```

HTTP request：

- `/api/<method>` POST 必须 application/json；M0 的 rc.6 contract 以 `/api/host.describe` 为最小 fixture；
- external Host/Origin guard先完成；
- rewrite 到 loopback；
- body 按上游上限流式/有界处理；
- 不注入 DSH credentials。

### 13.4 P1 不做的方法级 RBAC

DSH RPC 使用 `/api/<method>` 并在 body 中携带 envelope。P1 不承诺完整 method allowlist，原因：

- 方法不断变化；
- 大 body/图片可能导致代理层缓冲；
- 默认 preset 已有 Bash；
- 阻断个别 host 方法不能形成可靠只读语义。

可做的防御纵深：

- 如果请求体小于 1MiB 且可无损解析，记录匿名 method family 统计；
- 不记录参数；
- 不因解析失败放宽 Gateway Session/Origin guard；
- 不在 P1 UI 展示“受限模式”。

### 13.5 DSH target 更新

DSH stop/crash：

- Rust立即 disable target；
- Gateway 不再签 ticket；
- active WS close；
- Portal显示不可用；
- 不由 Gateway重启 DSH。

DSH restart同端口/新端口：原子更新 target，浏览器 generation 重连。

### 13.6 DSH E2E 必测

1. root/static/refresh；
2. `/api/host.describe`；
3. `events.mux` + `events.host` 同时打开；
4. workspace选择；
5. session create/list/resume；
6. prompt + streamed response；
7. tool call/Bash；
8. approval；
9. Settings/Models 页面；
10. 图片/大 body；
11. 两个远程 browser + 本地 pane；
12. DSH stop/crash/restart；
13. Gateway revoke；
14. required pin rc.6；
15. latest rc.7 observation lane。

---

## 14. Portal 规格

### 14.1 技术

- Go `embed` 静态 HTML/CSS/JS；
- 无前端 framework；
- 无 CDN、远程字体、analytics；
- 不依赖 Secure Context API；
- JS bundle 尽量 <100KiB gzip；
- 所有资源同源；
- 可禁用 JS 时显示手动码说明，但配对需要 JS 读取 fragment。

### 14.2 页面

```text
/_kickside/pair
/
/_kickside/connect
/_kickside/error
```

### 14.3 Portal API

```text
POST   /_kickside/api/pair
GET    /_kickside/api/session
DELETE /_kickside/api/session
GET    /_kickside/api/status
POST   /_kickside/api/tickets/kimi
POST   /_kickside/api/tickets/dsh
```

Portal API 不暴露：

- Kimi token；
- upstream URL/port；
- filesystem path；
- PID；
- DSH workspaceDir；
- admin API。

### 14.4 UI 风格

沿用 KickSide 设计语言：

- 灰白背景；
- 零渐变；
- 小型状态点；
- 13/14px 正文；
- 8/12px 圆角；
- 无大 Hero；
- 一个页面最多一个主要动作；
- 风险说明内联，不藏 tooltip。

---

## 15. React/Tauri API

### 15.1 Tauri commands

```text
lan_access_get_preflight
lan_access_get_settings
lan_access_save_settings
lan_access_get_status
lan_access_enable
lan_access_disable
lan_access_rotate_pairing
lan_access_list_clients
lan_access_revoke_client
lan_access_revoke_all_clients
lan_access_set_kimi_policy
lan_access_set_dsh_exposure
lan_access_get_log_tail
```

每个 command 必须进入 command registry、permission、build manifest 与 capability gate。

### 15.2 前端类型

```ts
export type LanAccessState =
  | "stopped"
  | "starting"
  | "running"
  | "degraded"
  | "stopping"
  | "error";

export interface LanAccessSettings {
  configured: boolean;
  preferredInterfaceId?: string;
  preferredBasePort: number;
  exposeKimi: boolean;
  exposeDsh: boolean;
}

export interface LanAccessPairingView {
  pairUrl: string;        // explicit dialog only
  manualCode: string;
  expiresAtMs: number;
}
```

`pairUrl` 不进入全局持久 store；Dialog close 时置空。

### 15.3 Controller

`useLanAccessController`：

- 初始 preflight/status；
- running 时 1s→5s 自适应轮询，或 Tauri event；
- pairing dialog 生命周期；
- enable/disable single flight；
- DSH确认；
- client revoke；
- runtime changed 后调用 reconcile。

推荐 Rust emit events：

```text
lan-access://status-changed
lan-access://client-changed
lan-access://error
```

前端仍保留低频轮询作为恢复路径。

### 15.4 Control Center 组件

`LanAccessSettingsPanel` 使用：

- `ControlCenterSettingsRow`；
- `ControlCenterStatusBadge`；
- `ControlCenterToggleField`；
- 现有 Button/Input；
- 不新增独立视觉系统。

---

## 16. 生命周期与 Shutdown 顺序

### 16.1 Enable

```text
1. acquire lan_gateway_lifecycle_operation
2. load settings
3. run probe / resolve selected interface
4. validate network profile
5. ensure Kimi available（P0）
6. resolve Gateway binary + version contract
7. create admin token file
8. spawn sidecar in owned process group
9. poll admin health
10. POST /v1/start
11. verify listeners locally
12. commit Running status
13. emit status event
```

任一步失败：停止 child、删除 token file、释放 listener、状态 Error。

### 16.2 Disable

```text
1. acquire lifecycle lock
2. state Stopping
3. admin POST /v1/stop
4. wait public listeners closed
5. terminate sidecar gracefully
6. timeout后整树强杀
7. delete admin token file
8. clear runtime state
9. state Stopped
```

### 16.3 App Quit / updater

必须调整全局 shutdown 顺序：

```text
LAN Gateway
→ IM Bridge / Agent Room external ingress
→ DSH
→ Kimi
→ remaining app resources
```

理由：先关闭所有外部入口，再关闭 upstream。

### 16.4 Parent death

Gateway监控 `KICKSIDE_LAN_PARENT_PID`：

- 定期检查 parent 存活；
- parent 消失后立即 close public listeners/session，随后退出；
- 这只是兜底，不能替代 Rust owned lifecycle。

### 16.5 Network watcher

P0 由 Rust或Gateway每 2s/事件化检查：

- selected interface 仍存在；
- IP/prefix 未变化；
- Windows profile 未变 Public；

变化时：

```text
stop public listeners
revoke all sessions
report E-LAN-010
sidecar exit
```

不自动绑定新接口。

---

## 17. Windows Firewall 规格

### 17.1 开发/AdHoc

- 不自动提权执行 netsh；
- enable 后显示系统可能弹窗；
- Public profile 默认阻断；
- 提供“打开 Windows 防火墙设置”和诊断说明；
- 日志记录 profile/rule state，不记录敏感网络详情到 telemetry。

### 17.2 Installed Release

建议安装器创建一条 rule group：

```text
Name: KickSide LAN Gateway
Program: <install-dir>\kickside-lan-gateway.exe
Protocol: TCP
LocalPort: 43100-43199
RemoteAddress: LocalSubnet
Profile: Private
Action: Allow
Enabled: Yes
```

Domain profile是否启用：

- 默认不启用，除非企业版本/明确设计；
- Public永不启用。

卸载必须删除 exact rule group。升级应保持或重建为当前 program path，不能积累重复规则。

### 17.3 Gate

NSIS、MSI 各验证：

- clean install；
- upgrade；
- repair；
- uninstall；
- user manually blocks；
- non-admin user；
- Private/Public切换；
- LocalSubnet only。

---

## 18. macOS 规格

- sidecar 必须纳入 app bundle签名；
- verify `codesign --verify --deep --strict`；
- notarization/stapling gate；
- inbound prompt 真实验证；
- Gatekeeper quarantine安装验证；
- App Quit/updater后 listener 关闭；
- 不申请 iOS Local Network permission（访问端是 Safari，不是 KickSide iOS app）；
- Tauri 自身不需要为了 Gateway listener 放宽 WebView CSP；LAN URL只由系统浏览器/手机访问。

---

## 19. 日志、审计与诊断

### 19.1 文件

```text
<app-data>/lan-gateway/lan-gateway.log
```

- 10MiB 轮转；
- 单行 64KiB；
- UTF-8 安全截断；
- 日志先 redactor；
- 7 天建议保留或随轮转自然淘汰。

### 19.2 可记录

- lifecycle；
- selected interface 名称与部分脱敏 IP；
- listener ports；
- pair success/fail count；
- client id（随机短 id）；
- service；
- method；
- route class，不含动态 path segment；
- status/duration/bytes；
- WS open/close；
- policy deny；
- upstream health；
- error code。

### 19.3 禁止记录

- pair secret/manual code；
- Cookie；
- Authorization；
- Kimi token；
- WS subprotocol token；
- query/fragment；
- request/response body；
- prompt/assistant内容；
- 文件名/完整路径；
- API key/credential；
-完整 UA。

### 19.4 Diagnostics View

```json
{
  "gatewayVersion": "0.1.0",
  "state": "running",
  "interface": "Wi-Fi",
  "address": "192.168.1.xxx/24",
  "ports": [43100, 43101, 43102],
  "networkProfile": "private",
  "clients": 1,
  "kimi": { "enabled": true, "healthy": true },
  "dsh": { "enabled": false, "healthy": false },
  "lastError": null
}
```

不含 public launch URL fragment、target URL、token file path。

---

## 20. 错误处理

### 20.1 Admin envelope

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "E-LAN-003",
    "message": "局域网端口不可用",
    "details": { "range": "43100-43199" }
  },
  "requestId": "..."
}
```

`details` 不能包含 secret/path/token。

### 20.2 Gateway HTTP status

| 场景 | HTTP |
|---|---:|
| 未配对/Session失效 | 401 |
| Host/Origin/policy拒绝 | 403 |
| pair/ticket过期 | 410 |
| rate limit | 429 |
| upstream unavailable | 502/503 |
| malformed request | 400/415 |
| Gateway overload | 503 |

### 20.3 UI 映射

Rust保留结构化 code；React依据 code 给动作，不解析英文错误字符串。

---

## 21. 测试规格

### 21.1 Go Unit

- interface filter；
- CIDR source guard；
- Host/Origin/Fetch Metadata；
- secret generation/hash/expiry/single-use；
- manual code rate limit；
- session TTL/revoke；
- ticket scope/IP/service；
- cookie filtering；
- header stripping；
- Location rewrite；
- target validation；
- Kimi route classifier；
- log redaction；
- parent death；
- listener triplet allocation；
- malformed query regression for GO-2026-4976行为。

### 21.2 Go Integration

Fake Kimi：

- static/REST/WS/subprotocol；
- streaming；
- multipart；
- Range；
- Set-Cookie collision；
- redirect；
- denied routes。

Fake DSH：

- `/api/<method>` JSON；
- 两条 WS；
- generation reconnect；
- large body；
- full-control flag。

### 21.3 Rust Unit/Integration

- settings schema 13→14；
- default off；
- binary resolution/version；
- token file permissions；
- admin OpenAPI fixtures deserialization；
- lifecycle single-flight；
- start rollback；
- stop/kill tree；
- network change；
- shutdown order；
- command registry。

### 21.4 React

- closed/running/error UI；
- multi-interface selection；
- public network block；
- QR dialog state cleared on close；
- DSH confirmation；
- client revoke；
- error actions；
- keyboard/a11y；
- no token URL rendered outside dialog/bootstrap。

### 21.5 Browser E2E

使用 Playwright 做桌面浏览器自动化；移动端最终由真机 G3。

P0：

- pair fragment；
- portal cookie；
- Kimi ticket/cookie；
- Kimi token bootstrap；
- WS；
- deny routes；
- revoke；
- stop；
- network target update。

P1：

- DSH ticket；
- dual WS；
- session/prompt/tool/approval；
- runtime stop/restart。

### 21.6 Security Tests

- DNS rebinding Host；
- cross-site simple POST；
- `Origin:null`；
- spoofed X-Forwarded；
- slowloris；
- header bomb；
- pair brute force；
- query parameter overflow；
- path traversal in reserved endpoints；
- cookie overwrite；
- log secret canary；
- source outside subnet；
- stale ticket replay；
- WS without Session；
- admin API from LAN。

---

## 22. Gate 分层

### G0

```bash
pnpm -C apps/kimi-shell typecheck
cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml
go vet ./...
```

### G1

```bash
pnpm -C apps/kimi-shell test
cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml
go test ./...
go test -race ./...
govulncheck ./...
```

### G2

- Windows/macOS CI build sidecar；
- target triple binary smoke；
- command registry；
- security NFR script；
- Kimi required contract canary；
- DSH rc.6 required + rc.7 observational；
- SBOM/license scan；
- installer package build。

### G3

P0：

- Windows 10/11 installed build；
- macOS signed/notarized build；
- iPhone Safari；
- Android Chrome；
- second Windows/macOS browser；
- Private/Public profile；
- firewall allow/deny；
- Wi-Fi切换、sleep/wake、App Quit、updater；
- token/secret diagnostic package manual audit。

P1：

- DSH rc.6 full flow；
- two remote clients + local pane；
- Bash/approval；
- dual WS reconnect；
- DSH crash/restart；
- exposure stop without runtime stop。

未完成 G3，只能声明“已实现/G0-G2 已验证”，不能声明发布完成。

---

## 23. 文档与治理触发

实现必须同步：

- accepted ADR；
- `.ai/architecture/current-state.md`；
- `.ai/architecture/verification-gates.md`；
- 根 README 的能力/安全说明；
- `apps/kimi-shell/README.md`；
- 新 `apps/kickside-lan-gateway/README.md`；
- third-party notices；
- `.ai/changes/YYYY-MM-DD.md`；
- `tasks/todo.md`；
- release notes；
- privacy/security说明。

不修改 `.ai/CONSTITUTION.md`，除非实现需要放宽现有秘密规则；本 Spec 不允许放宽。

---

## 24. 未来兼容点（不在 P0/P1 实现）

Gateway 内部只保留以下窄 seam：

```go
type PublicTransport interface {
    ListenPortal(...) (net.Listener, error)
    ListenService(...) (net.Listener, error)
}
```

但 P0 不建立可插拔 registry，只使用 LAN TCP。未来出现 Tailscale/tsnet 的第二实现时再提取；当前可以将 listener factory 作为内部函数，不导出接口。

未来候选：

- Tailscale/tsnet HTTPS；
- persistent device certificates；
- mDNS `kickside.local`；
- complete remote Portal；
- encrypted local transport；
- enterprise policy。
