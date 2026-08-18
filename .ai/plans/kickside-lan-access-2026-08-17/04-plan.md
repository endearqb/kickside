# Plan · KickSide 局域网访问实施计划

> **状态：未来备选架构档案。** 当前实施计划以 `09-native-lan-plan.md` 为准；本文 M0/M1 Gateway 任务已取消。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17 |
| 状态 | Ready for implementation planning；未开始代码实施 |
| 依据 | `01-research.md`、`02-prd.md`、`03-spec.md` |
| 基线 | KickSide `main@a9c916e60d1cce113c644dbb4adf51f530bb7959` · `v0.2.2` |
| 路线 | M0 事实 Spike → M1 Gateway 基础 → M2 Kimi P0 → M2.5 P0 G3 → M3 DSH P1 → M3.5 P1 G3 |
| 规模标记 | XS / S / M / L / XL 只表达相对复杂度，不是交付时间承诺 |

---

## 0. 实施总则

1. **先 ADR 与 M0，再写产品代码。** HTTP 私有 IP、移动 Safari、Kimi WS、DSH 双 WS 和防火墙均存在实质不确定性。
2. **第一阶段与第二阶段分 PR。** DSH 不得混入 Kimi P0 的首个可发布 PR。
3. **保持 upstream loopback。** 任何实现试图修改 Kimi/DSH bind host，应立即停止并重新审查。
4. **安全前置。** Pairing、Session、Host/Origin guard、日志脱敏必须早于 proxy 接入真实 Runtime。
5. **Gateway 先 fake upstream，再真实上游。** 先证明代理契约，再排查上游 UI。
6. **每个里程碑独立可回滚。** LAN feature 默认关闭；回滚不影响本地 Kimi/DSH。
7. **G3 不可被自动化替代。** Windows Firewall、macOS 签名和移动浏览器必须真机。
8. **不在计划中预建通用 Remote Provider。** Tailscale 不在 P0/P1。
9. **所有完成状态按项目宪法用词。** 已实现 / 已验证 / blocked / 已发布。

---

## 1. 工作流与分支建议

建议分支：

```text
codex/lan-access-p0
codex/lan-access-p1-dsh
```

建议文档入库位置：

```text
.ai/plans/lan-access-2026-08-17/
├─ 01-research.md
├─ 02-prd.md
├─ 03-spec.md
└─ 04-plan.md
```

建议先建立 ADR：

```text
.ai/decisions/2026-08-17-lan-gateway-sidecar-and-loopback-boundary.md
```

建议 PR 切分：

1. PR-A：ADR + M0 spikes + test harness，不含用户入口；
2. PR-B：Gateway foundation + Tauri lifecycle，feature flag hidden；
3. PR-C：Kimi P0 product/UI + automated gates；
4. PR-D：P0 G3/installer/firewall/release docs；
5. PR-E：DSH P1；
6. PR-F：P1 G3/release evidence。

若团队希望减少 PR 数，至少保持“Kimi P0”和“DSH P1”两个独立 PR。

---

## 2. M0 · 事实 Spike 与 Go/No-Go

### 2.1 M0 目标

在引入正式用户设置前证明：

- browser-only HTTP LAN topology 可用；
- Kimi 核心协议能通过 Go proxy；
- DSH rc.6 的 `/api/<method>` + 双 WS 能通过 proxy；
- iOS/Android 的 ticket/cookie 流程成立；
- Windows/macOS 有可发布的 listener/防火墙路径；
- Go 1.26.6+ 安全工具链可进入 CI。

### 2.2 M0 任务

| ID | 规模 | 任务 | 产出 | 验证 |
|---|---:|---|---|---|
| S0-01 | S | 写 accepted ADR 与威胁模型 | ADR、Research 对齐记录 | 文档 review |
| S0-02 | S | 建立 `apps/kickside-lan-gateway` 最小 Go module | `--version`、`probe` skeleton | Go vet/test |
| S0-03 | M | 构建 fake Kimi upstream | REST、WS subprotocol、stream、range、upload、redirect fixture | integration tests |
| S0-04 | M | 构建 fake DSH upstream | `/api/host.describe`、`events.mux`、`events.host` fixture | integration tests |
| S0-05 | M | 最小 ReverseProxy spike | Host/Origin rewrite、WS、Location、Cookie filter | fake upstream matrix |
| S0-06 | S | 固定 Go 1.26.6 toolchain + govulncheck | CI lane / local script | 已知 Go 标准库漏洞不命中 |
| S0-07 | M | Kimi 真实代理 Spike | browser top-level、token、WS、prompt | desktop browser + logs |
| S0-08 | M | Kimi移动 HTTP Spike | iOS Safari/Android Chrome | 真机 evidence |
| S0-09 | M | 三端口 pair/ticket/cookie Spike | Portal→Kimi跨端口 Session | iOS/Android/desktop |
| S0-10 | M | DSH rc.6真实代理 Spike | `/api/<method>` + 双 WS + session | 真机/browser evidence |
| S0-11 | S | DSH rc.7观察测试 | compatibility diff | observational report |
| S0-12 | M | Windows listener/firewall Spike | Private/Public、allow/block、rule方案 | clean VM evidence |
| S0-13 | M | macOS sidecar签名/防火墙 Spike | nested binary签名与入站提示 | signed adhoc/Developer ID evidence |
| S0-14 | M | network change/sleep Spike | stop/revoke行为 | Windows/macOS各一次 |
| S0-15 | S | Kimi API route inventory | current OpenAPI分类表 | review high-risk routes |

### 2.3 M0 实验实现约束

Spike 可以：

- 使用临时端口；
- 使用简单 CLI pair secret；
- 不接入 Control Center；
- 不持久化设置；
- 只在开发构建运行。

Spike 不能：

- 直接绑定 upstream；
- 关闭 Kimi auth；
- 把 token/secret 写日志；
- 以首页 200 代替协议验证；
- 把 rc.7 结果当作 KickSide pin 的发布结论。

### 2.4 M0 Go / No-Go

#### P0 Kimi Go 条件

全部满足：

- [ ] Kimi root/static/REST/WS/subprotocol 可经 proxy；
- [ ] iOS Safari 与 Android Chrome 可完成配对和 Kimi bootstrap；
- [ ] HTTP 私有 IP 未触发无法绕开的 Secure Context 硬依赖；
- [ ] token 不进入 server log/diagnostics；
- [ ] Windows/macOS 至少存在可用入站授权路径；
- [ ] Gateway stop/revoke 能关闭 active WS；
- [ ] Go 1.26.6 + race + govulncheck 可执行。

任一核心条件失败，P0 为 blocked；不得通过直接 `0.0.0.0` 绕过。

#### P1 DSH Go 条件

全部满足：

- [ ] rc.6 `/api/<method>` 正常；
- [ ] `events.mux` 与 `events.host` 同时建立；
- [ ] session/prompt/stream/tool/approval/Bash 正常；
- [ ] 两个浏览器 + 本地 pane 共存；
- [ ] stop/restart/target update 可恢复；
- [ ] full-control风险被产品确认接受。

P1失败不阻塞P0。

---

## 3. M1 · Gateway Foundation

### 3.1 目标

建立不依赖 Kimi/DSH 的可验证 Gateway 基础：build、sidecar lifecycle、admin contract、interface probe、listener、guard、pair/session、Portal skeleton。

### 3.2 Go 模块任务

| ID | 规模 | 内容 | 主要文件 | 验证 |
|---|---:|---|---|---|
| T1-01 | S | Go module、buildinfo、`--version` | `go.mod`、`cmd/.../main.go` | version smoke |
| T1-02 | M | interface probe 与 RFC1918 filter | `internal/interfaceprobe` | table tests |
| T1-03 | S | target triplet allocation | `internal/gateway/ports.go` | conflict tests |
| T1-04 | M | Admin token file auth | `internal/adminapi/auth.go` | 401/rate tests |
| T1-05 | L | OpenAPI admin contract与handlers | `api/openapi.yaml`、`internal/adminapi` | fixtures/contracts |
| T1-06 | M | Gateway state/lifecycle | `internal/gateway` | start/stop/idempotency |
| T1-07 | M | Host/RemoteAddr/Origin/Fetch guard | `internal/httpguard` | rebinding/cross-site tests |
| T1-08 | M | Pairing secret/manual code/limits | `internal/pairing` | entropy/TTL/replay/brute tests |
| T1-09 | M | Session/ticket store | `internal/session` | TTL/revoke/scope tests |
| T1-10 | M | Portal静态页 skeleton | `internal/portal` | browser test |
| T1-11 | S | Audit/redaction/rotation | `internal/audit` | secret canary |
| T1-12 | M | Parent death与graceful shutdown | `internal/shutdown` | fake parent/process tests |

### 3.3 Tauri lifecycle 任务

| ID | 规模 | 内容 | 主要文件 | 验证 |
|---|---:|---|---|---|
| T1-13 | M | `lan_access_manager` skeleton | Rust manager/state | lifecycle unit |
| T1-14 | S | Gateway binary locator/version | manager + buildinfo | missing/mismatch tests |
| T1-15 | M | admin token file ACL/cleanup | Rust | Unix/Windows tests |
| T1-16 | M | spawn/monitor/stop process tree | manager lifecycle | descendant tests |
| T1-17 | M | `lan_gateway_client` OpenAPI mapping | Rust client | fixture deserialize |
| T1-18 | S | AppState/lifecycle mutex | `app_state.rs` | compile/unit |
| T1-19 | S | shutdown order先Gateway | app quit/updater path | integration test |
| T1-20 | S | hidden Tauri commands | commands/permissions/build.rs | registry gate |

### 3.4 Build 与打包任务

| ID | 规模 | 内容 |
|---|---:|---|
| T1-21 | M | 提取 `go_sidecar_build_utils.mjs`，保持 Bridge行为不变 |
| T1-22 | S | 新 `build_lan_gateway_sidecar.mjs` |
| T1-23 | S | package scripts串联两个 sidecar build |
| T1-24 | S | `tauri.conf.json externalBin` 加 Gateway |
| T1-25 | S | target triple smoke for Windows/macOS |
| T1-26 | S | third-party notices / SBOM入口 |

### 3.5 M1 验收

- [ ] app 可启动/停止 Gateway sidecar，但 UI 入口隐藏；
- [ ] Gateway 只监听选中的测试接口；
- [ ] Admin API LAN不可达；
- [ ] QR pairing + Portal session 在 fake环境可用；
- [ ] stop 后 Session、listener、WS、token file、child全部消失；
- [ ] Bridge sidecar build/lifecycle无回归；
- [ ] command registry、G0/G1通过；
- [ ] 日志 secret canary为0。

---

## 4. M2 · 第一阶段 P0：Kimi LAN Access

### 4.1 Runtime Integration

| ID | 规模 | 内容 | 对应需求 |
|---|---:|---|---|
| T2-01 | M | 从现有 Kimi runtime投影 target/tokenFile，不读取 persisted URL | FR-LAN-009/018 |
| T2-02 | M | enable flow确保 Kimi running或给 E-LAN-008 | FR-LAN-001/008 |
| T2-03 | M | target/token rotate reconcile | FR-LAN-018 |
| T2-04 | M | Kimi authenticated health probe | FR-LAN-007/008 |

### 4.2 Proxy Core

| ID | 规模 | 内容 | 验证 |
|---|---:|---|---|
| T2-05 | L | 通用 ReverseProxy rewrite/header/Location/stream | fake Kimi integration |
| T2-06 | L | WebSocket + subprotocol + revoke close | fake/real Kimi |
| T2-07 | M | multipart/Range/ETag/large body | fixtures |
| T2-08 | M | Gateway cookie remove/upstream reserved Set-Cookie block | malicious fixture |
| T2-09 | M | source subnet/connection/resource limits | load/security tests |

### 4.3 Kimi Policy

| ID | 规模 | 内容 |
|---|---:|---|
| T2-10 | M | OpenAPI route inventory generator/fixture |
| T2-11 | M | route classifier与default deny classes |
| T2-12 | S | Kimi envelope-compatible policy response |
| T2-13 | S | policy settings只在当前 lifecycle应用 |
| T2-14 | M | terminal/shutdown/host FS/OAuth deny E2E |

### 4.4 Portal 与配对

| ID | 规模 | 内容 |
|---|---:|---|
| T2-15 | M | 完整 Portal status/cards |
| T2-16 | M | Kimi service ticket/connect bootstrap |
| T2-17 | S | token fragment生成、no-store、清理 |
| T2-18 | M | connected clients与revoke UI/API |
| T2-19 | S | QR SVG/PNG library pin与license |
| T2-20 | S | manual code fallback与倒计时 |

### 4.5 Control Center

| ID | 规模 | 内容 | 文件 |
|---|---:|---|---|
| T2-21 | M | `lanAccessService.ts` | services |
| T2-22 | M | `useLanAccessController.ts` | app |
| T2-23 | L | `LanAccessSettingsPanel` | control center |
| T2-24 | M | Pairing dialog | control center |
| T2-25 | M | Device list/revoke | control center |
| T2-26 | S | 网络接口 picker / Public block | control center |
| T2-27 | S | error actions/log tail | control center |
| T2-28 | S | a11y/320px mobile Portal | UI tests |

### 4.6 Settings 与 Commands

| ID | 规模 | 内容 |
|---|---:|---|
| T2-29 | M | settings schema 14 + migration/default tests |
| T2-30 | S | LAN Tauri commands完整注册 |
| T2-31 | S | status event + low-frequency polling fallback |
| T2-32 | S | diagnostics redacted projection |

### 4.7 P0 自动化验收

- [ ] Go unit/integration/race/vuln；
- [ ] Rust lifecycle/schema/commands；
- [ ] React UI；
- [ ] Playwright pair→Portal→Kimi；
- [ ] real Kimi REST/WS/prompt/approval/upload/download；
- [ ] policy deny；
- [ ] token rotate；
- [ ] target port change；
- [ ] client revoke；
- [ ] source outside subnet；
- [ ] Host/Origin/rebinding；
- [ ] slowloris/header/query overflow；
- [ ] secret canary。

### 4.8 P0 Exit Criteria

进入 G3 前：

1. 所有 P0 FR 有代码和自动化入口；
2. G0/G1/G2通过；
3. feature默认关闭；
4. README/ADR/current-state/verification gates更新；
5. 未知 Kimi写路由已评审或 fail closed；
6. no open P0 severity-high security bug；
7. DSH仍不可通过 public Gateway进入。

---

## 5. M2.5 · P0 双平台 G3 与发布收口

### 5.1 Windows G3

测试矩阵：

| 场景 | Windows 10 | Windows 11 |
|---|---:|---:|
| NSIS clean install | 必须 | 必须 |
| MSI clean install | 可选/按现有发布矩阵 | 必须 |
| Private profile + firewall allow | 必须 | 必须 |
| Public profile默认阻断 | 必须 | 必须 |
| 用户拒绝防火墙提示 | 必须 | 必须 |
| installer rule创建/升级/删除 | 必须 | 必须 |
| Edge / Chrome | 至少一组 | 两组 |
| App Quit / tray exit / updater exit | 必须 | 必须 |
| Wi-Fi切换 / sleep-wake | 必须 | 必须 |
| child/port residual | 0 | 0 |

任务：

| ID | 规模 | 内容 |
|---|---:|---|
| G3-P0-W01 | L | NSIS firewall rule实施与回滚 |
| G3-P0-W02 | L | MSI firewall rule实施与回滚 |
| G3-P0-W03 | M | clean VM evidence scripts/checklist |
| G3-P0-W04 | M | Edge/Chrome Kimi完整流程 |
| G3-P0-W05 | M | network profile切换/阻断 |
| G3-P0-W06 | M | updater/quit/descendant/port cleanup |

### 5.2 macOS G3

| 场景 | 要求 |
|---|---|
| Apple Silicon macOS 13+ | 至少 macOS 13基线 + 当前版本 |
| signed/notarized app | 必须 |
| nested sidecar signature | 必须 |
| firewall prompt | 记录截图与行为 |
| Safari/Chrome desktop | 必须 |
| iPhone Safari同Wi-Fi | 必须 |
| App Quit/updater | listener/child 0 |
| Wi-Fi切换/sleep | stop/revoke |

任务：

| ID | 规模 | 内容 |
|---|---:|---|
| G3-P0-M01 | M | bundle/codesign/notarization审查 |
| G3-P0-M02 | M | inbound firewall真实流程 |
| G3-P0-M03 | M | Safari/Chrome/iPhone流程 |
| G3-P0-M04 | M | quit/updater/network change证据 |

### 5.3 Android/iOS

至少覆盖：

- 扫码；
- 手动码；
- Portal session；
- Kimi service connect；
- background 5min再回来；
- WS断线恢复；
- approval；
- revoke；
- KickSide stop后的页面行为。

### 5.4 G3 Evidence

建议新增：

```text
.ai/plans/lan-access-2026-08-17/05-p0-g3-checklist.md
.ai/plans/lan-access-2026-08-17/evidence/
```

Evidence 只记录 redacted IP，例如 `192.168.1.xxx`，不含 QR/token/cookie。

### 5.5 P0 发布门

全部满足才能称“已发布”：

- [ ] Windows与macOS installed build G3；
- [ ] iOS与Android至少各一台真机；
- [ ] firewall/private/public；
- [ ] secret/token诊断包人工审计；
- [ ] updater/quit无残留；
- [ ] release notes明确 HTTP/可信网络限制；
- [ ] feature默认关闭；
- [ ] rollback路径验证。

---

## 6. M3 · 第二阶段 P1：DSH LAN Access

### 6.1 前置硬门

P1开始前必须：

- P0已通过G3或至少Gateway核心在双平台G3稳定；
- DSH本地rc.6自身G3状态明确；
- S0-10 DSH proxy Spike通过；
- 产品负责人接受full-control语义；
- 无开放的Gateway high severity security bug。

### 6.2 Runtime 投影

| ID | 规模 | 内容 |
|---|---:|---|
| T3-01 | M | 从 `DshStatus` 投影 exact loopback target/pin/state |
| T3-02 | M | DSH start/stop/crash/restart reconcile |
| T3-03 | S | Gateway不拥有DSH lifecycle的测试 |
| T3-04 | S | local pane与remote target一致性检查 |

### 6.3 DSH Proxy

| ID | 规模 | 内容 |
|---|---:|---|
| T3-05 | M | static/SPA fallback proxy |
| T3-06 | L | `/api/<method>` JSON RPC proxy与限制 |
| T3-07 | L | `/api/events.mux` WS |
| T3-08 | L | `/api/events.host` WS |
| T3-09 | M | dual WS generation/reconnect |
| T3-10 | M | large body/image/resource limit |
| T3-11 | S | DSH reserved cookie/session isolation |

### 6.4 Product/UI

| ID | 规模 | 内容 |
|---|---:|---|
| T3-12 | M | `exposeDsh` setting默认false |
| T3-13 | M | current-generation full-control confirm dialog |
| T3-14 | S | Portal DSH status/action/risk text |
| T3-15 | M | DSH service ticket/session/revoke |
| T3-16 | S | stop sharing不stop Runtime |
| T3-17 | S | degraded/stopped/crashed UX |

### 6.5 Contract Gates

| ID | 规模 | 内容 |
|---|---:|---|
| T3-18 | M | rc.6 required canary |
| T3-19 | S | rc.7/latest observational canary |
| T3-20 | S | pin mismatch E-LAN-013 |
| T3-21 | M | protocol fixtures随pin升级审查 |

### 6.6 P1 自动化验收

- [ ] root/static/history refresh；
- [ ] `/api/host.describe`；
- [ ] dual WS；
- [ ] workspace/session；
- [ ] prompt/stream；
- [ ] tool/Bash；
- [ ] approval；
- [ ] Settings/Models；
- [ ] large image/body；
- [ ] two remote browsers + local panes；
- [ ] revoke；
- [ ] DSH crash/restart；
- [ ] stop exposure vs stop Runtime；
- [ ] rc.6 required；
- [ ] rc.7 observational。

---

## 7. M3.5 · P1 G3 与发布

### 7.1 真机矩阵

Windows + macOS各执行：

1. 本地 Kimi pane + DSH pane；
2. 手机进入 Kimi；
3. 第二设备进入 DSH；
4. DSH session/prompt/Bash/approval；
5. 关闭一个remote tab，不停Runtime；
6. 控制中心停止DSH共享，remote立即断；
7. 本地DSH继续运行；
8. 再次开启并重新ticket；
9. 停止DSH Runtime，remote不可进入；
10. 重启DSH并恢复；
11. App Quit全部external surface先关闭。

### 7.2 发布条件

- [ ] P0全部回归；
- [ ] P1 required rc.6 G3；
- [ ] full-control风险文案review；
- [ ] 默认false迁移测试；
- [ ] no claim of read-only/sandbox；
- [ ] two-client soak；
- [ ] DSH日志/凭据不进入Gateway audit；
- [ ] latest observation结果在release notes中准确表述。

---

## 8. 测试与 CI 变更清单

### 8.1 新脚本

```text
apps/kimi-shell/scripts/build_lan_gateway_sidecar.mjs
apps/kimi-shell/scripts/check_lan_gateway_contract.mjs
apps/kimi-shell/scripts/lan_gateway_security_smoke.mjs
apps/kimi-shell/scripts/lan_gateway_kimi_canary.mjs
apps/kimi-shell/scripts/lan_gateway_dsh_canary.mjs
```

### 8.2 package scripts

建议：

```json
{
  "build:go-sidecars": "pnpm build:bridge-sidecar && pnpm build:lan-gateway-sidecar",
  "check:lan-gateway": "...",
  "check:lan-security": "..."
}
```

`beforeDevCommand` 与 `beforeBuildCommand` 改用统一脚本，但必须保证 Bridge原行为测试通过。

### 8.3 CI jobs

```text
lan-gateway-go
lan-gateway-race
lan-gateway-govulncheck
lan-gateway-contract
lan-gateway-kimi-required
lan-gateway-dsh-required-rc6
lan-gateway-dsh-latest-observational
lan-gateway-windows-package
lan-gateway-macos-package
```

Observational lane 失败不能把 required build标红，但必须生成可见警告/issue；required pin失败阻塞。

---

## 9. 安全 Review Checklist

每个实现 PR 必须回答：

### Secrets

- [ ] 是否新增 secret？
- [ ] 是否仅 env/token file？
- [ ] 是否可能进入 argv、log、diagnostic、telemetry、URL query？
- [ ] QR dialog close后前端内存是否清除？

### Listener

- [ ] 是否精确绑定IP？
- [ ] 是否限同子网？
- [ ] 是否Public默认阻断？
- [ ] stop后端口是否释放？

### Browser

- [ ] Host exact？
- [ ] Origin exact？
- [ ] cross-site拒绝？
- [ ] Cookie名隔离？
- [ ] pairing replay/rate limit？

### Proxy

- [ ] target是否loopback-only？
- [ ] forwarded headers是否清除？
- [ ] Gateway Cookie是否不进upstream？
- [ ] upstream保留Cookie是否不能覆盖Gateway？
- [ ] WS revoke是否关闭？
- [ ] body/header/connection是否有界？

### Runtime

- [ ] Kimi auth是否仍开启？
- [ ] DSH是否默认关闭？
- [ ] Gateway是否误拥有upstream lifecycle？
- [ ] 高风险路由是否符合policy？

---

## 10. 故障注入计划

### P0

- 占满43100-43199；
- 删除Gateway binary；
- admin token file权限错误；
- Kimi token file轮换/删除；
- Kimi启动后立即崩溃；
- WS中途Kimi重启；
- malicious Host/Origin；
- source来自不同子网；
- pair brute force；
- slow request/header bomb；
- 1GiB upload（必须流式/拒绝而非OOM）；
- Windows用户拒绝firewall；
- macOS网络切换；
- App进程强杀；
- Gateway自己panic/kill。

### P1

- DSH一条WS失败；
- DSH两条WS顺序反转；
- `/api/<method>` malformed JSON；
- DSH body超过上限；
- DSH rc.7行为变化；
- 本地pane切session时remote并发；
- stop exposure during Bash；
- DSH crash then restart new port。

---

## 11. 观测与诊断实施

### 11.1 本地指标

Gateway status提供：

```text
requests_total{service,status_class}
active_connections{service}
active_websockets{service}
pair_attempts{result}
policy_denies{class}
upstream_failures{service}
bytes_in/out{service}
```

只通过admin API给Desktop，不开公网metrics endpoint。

### 11.2 Telemetry（可选）

若KickSide现有匿名遥测接入：

允许：

```text
lan_enable_result
lan_pair_success
lan_service_open_result
lan_error_code
```

禁止：

- IP；
- port；
- browser/UA原文；
- URL；
- workspace；
- session/client ID；
- Kimi/DSH消息；
- secret/token。

---

## 12. 文档更新计划

### M0

- ADR；
- Research/PRD/Spec/Plan；
- `tasks/todo.md`；
- `.ai/changes`。

### P0 实现

- `apps/kickside-lan-gateway/README.md` contract；
- root README能力与安全限制；
- `apps/kimi-shell/README.md`；
- `.ai/architecture/current-state.md`；
- `.ai/architecture/verification-gates.md`；
- third-party notices；
- privacy/security说明；
- release notes；
- Windows/macOS G3 checklist。

### P1 实现

- DSH LAN full-control说明；
- required/observational pin说明；
- DSH G3 evidence；
- release notes。

---

## 13. 回滚计划

### 13.1 Feature 回滚

由于默认关闭，紧急回滚可：

1. 隐藏 Control Center入口；
2. settings保留但忽略 `lanAccess`；
3. 不spawn Gateway；
4. 保留schema 14 additive字段；
5. 不删除用户设置字段，避免单向迁移回退；
6. installer upgrade删除/禁用firewall rule（若确认Gateway不再使用）。

### 13.2 Gateway binary 回滚

- sidecar version与Shell contract version握手；
- mismatch fail closed；
- updater原子替换整个app bundle；
- 不允许新Shell连接旧Gateway admin contract并“尽量工作”。

### 13.3 DSH P1 回滚

可只禁用 `exposeDsh`：

- Kimi P0不受影响；
- DSH本地pane不受影响；
- settings字段保留；
- Portal不显示入口；
- Gateway不监听DSH public port。

---

## 14. 建议提交序列

### PR-A

```text
chore: add LAN gateway research ADR and spike harness
```

- docs；
- Go module skeleton；
- fake upstream；
- no product UI。

### PR-B

```text
feat: add managed LAN gateway foundation
```

- build/sidecar/admin/lifecycle；
- pairing/session/Portal skeleton；
- hidden flag。

### PR-C

```text
feat: add paired Kimi Code LAN access
```

- Kimi proxy/policy；
- UI/QR/device revoke；
- tests/docs。

### PR-D

```text
release: complete LAN access platform gates
```

- firewall/installers；
- macOS signing；
- G3 evidence；
- release notes。

### PR-E

```text
feat: add opt-in DSH LAN access
```

- DSH adapter；
- full-control confirmation；
- required/observational canary。

### PR-F

```text
release: complete DSH LAN access gates
```

---

## 15. Definition of Done

### P0 已实现

- 代码在；
- G0通过；
- 默认关闭；
- Kimi功能面完整；
- security guard/policy存在；
- docs更新。

### P0 已验证

- G1/G2全部通过；
- 两平台至少自动化包构建；
- 真机未完成项明确标blocked。

### P0 已发布

- M2.5全部G3；
- installer/firewall；
- iOS/Android；
- signed macOS；
- release artifact与notes。

### P1 已实现/已验证/已发布

同样按M3/M3.5分层，不得用P0证据替代DSH证据。

---

## 16. 执行优先级

### 必须先做

1. ADR/Threat Model；
2. Go 1.26.6/toolchain/vuln；
3. fake upstream与proxy；
4. mobile pair/cookie Spike；
5. Kimi真实WS；
6. Windows/macOS firewall Spike。

### 可后置但P0发布前完成

- installer firewall rule；
- full client list polish；
- audit UI；
- performance baseline。

### 明确不提前做

- Tailscale；
- HTTPS；
- mDNS；
- persistent devices；
- RBAC；
- full KickSide web；
- DSH method sandbox；
- generic transport/provider registry。
