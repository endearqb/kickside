# PRD · KickSide 局域网访问（第一、二阶段）

> **状态：未来备选架构档案。** 当前产品需求以 `07-native-lan-prd.md` 为准；本文的 Gateway 与 DSH 范围不进入 MVP。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17 |
| 状态 | Draft for review；未实现、未验证、未发布 |
| 上游文档 | `01-research.md` |
| 下游文档 | `03-spec.md`、`04-plan.md` |
| KickSide 基线 | `main@a9c916e60d1cce113c644dbb4adf51f530bb7959` · `v0.2.2` |
| 第一阶段 | P0：Kimi Code 局域网访问 |
| 第二阶段 | P1：DeepSeek Harness 局域网访问 |

---

## 1. 背景

KickSide 已把 Kimi Code 与 DeepSeek Harness 放进一个受管桌面工作台，但使用入口仍依赖运行 KickSide 的那台电脑。用户在家中、办公室或会议室里，经常希望：

- 在手机上查看长任务进度；
- 在另一台电脑上继续会话；
- 离开桌面座位后处理 approval/question；
- 在同一 Wi-Fi 下快速打开 Kimi Code 或 DSH；
- 不安装第二套桌面应用，不配置公网 IP，不学习 Tailscale。

当前两个 Runtime 都只监听 loopback，这是正确的本机安全边界。局域网功能应在边界外新增受管 Gateway，而不是修改 Kimi/DSH 的监听行为。

---

## 2. 问题定义

普通用户面对局域网访问时有四个障碍：

1. 不知道本机 IP、端口、Host/Origin、WebSocket 等网络概念；
2. 不知道如何安全暴露能执行命令的 coding agent；
3. Windows/macOS 防火墙、访客 Wi-Fi和网卡切换导致“看起来开启、实际不可用”；
4. Kimi 与 DSH 的协议、安全和鉴权不同，不能要求用户分别配置。

产品需要把这些复杂性收口成一个明确动作：

> 在可信的同一局域网中开启 KickSide，扫码后从浏览器进入本机的 Kimi Code 或 DSH。

---

## 3. 产品原则

1. **Loopback 不变量**：Kimi Code、DSH 继续只监听 `127.0.0.1`。
2. **用户显式授权**：局域网访问默认关闭；P0 每次 KickSide 启动后需手动开启。
3. **Gateway 是唯一入口**：远程设备不得直连 upstream Runtime。
4. **最小权限默认值**：Kimi 高风险本机路由默认拒绝；DSH 默认不共享。
5. **不制造虚假安全感**：第一版为 HTTP，只适用于可信家庭/办公网络。
6. **可撤销**：停止共享、网络变化、应用退出会立即撤销 Session 并关闭 listener。
7. **不持久化秘密**：配对 Secret、Cookie、Kimi token、运行 URL 不进入 settings、Grid、日志或诊断包。
8. **先 Kimi、后 DSH**：P1 不得绕过 P0 的 Gateway、配对、浏览器和双平台验证。
9. **移动端是直接 Web UI**：首期不复制完整 KickSide Tauri UI，只提供轻量 Portal 和两个上游 Web surface。
10. **失败可诊断**：用户能区分 Runtime 未启动、防火墙阻断、网络隔离、配对过期和 upstream 崩溃。

---

## 4. 目标用户

### 4.1 核心用户

- 在个人电脑上使用 KickSide 的独立开发者；
- 在家庭或小型办公室网络中工作；
- 同时拥有手机、平板或另一台电脑；
- 希望在不离开当前工作区的情况下远程查看、输入和审批；
- 不具备网络运维知识。

### 4.2 暂不覆盖的用户

- 需要公网访问或跨城市访问的用户；
- 需要企业级 SSO、RBAC、审计留存和端到端加密的团队；
- 需要在酒店/机场/咖啡店公共 Wi-Fi 使用的用户；
- 需要把 KickSide 作为 7×24 多租户服务器的用户。

---

## 5. 核心用户场景

### US-01：手机扫码进入 Kimi

作为 KickSide 用户，我在电脑控制中心开启局域网访问，手机连同一 Wi-Fi 后扫码，可以进入当前电脑上的 Kimi Code Web，而不需要输入 IP 或端口。

### US-02：另一台电脑继续会话

作为用户，我在同一办公网络的另一台电脑浏览器中完成配对，进入 Kimi 会话、查看流式输出并提交后续 prompt。

### US-03：远程处理审批

作为用户，我离开电脑后仍能在手机浏览器中看到 Kimi approval/question，并作出决定。

### US-04：立即撤销

作为用户，我可以在 KickSide 控制中心撤销某个浏览器 Session，或停止整个局域网访问；已打开的页面应立即失效。

### US-05：明确的网络故障提示

作为用户，如果手机无法连接，我能看到“当前是公共网络”“Windows 防火墙可能阻断”“访客 Wi-Fi 禁止设备互访”等具体原因，而不是一个模糊错误。

### US-06：选择性开放 DSH

作为使用 DSH 的高级用户，我可以在已启用的 LAN Gateway 上单独开启 DSH，并在看到完整风险说明后，从手机或另一台电脑进入 DSH Web。

### US-07：Runtime 重启后收敛

作为用户，当 Kimi 或 DSH 重启并更换本地端口时，Gateway 会更新 upstream target；浏览器连接可恢复或得到可执行的重新进入提示，不会转发到陈旧端口。

---

## 6. 目标

### 6.1 第一阶段 P0 目标

1. 用户可在 3 个可见操作以内开启 Kimi 局域网访问并显示 QR。
2. 同一可信局域网中的现代手机/桌面浏览器可完成配对并使用 Kimi 核心 Web 功能。
3. Kimi 与 Gateway 均保持受管生命周期；关闭后无 listener、无有效 Session、无孤儿进程。
4. 默认不暴露 PTY、shutdown、debug、远程 OAuth 与高风险主机文件操作。
5. Windows/macOS 各有可执行的防火墙诊断和发布验证路径。
6. 所有 token/secret/cookie 均不进入持久化或日志。

### 6.2 第二阶段 P1 目标

1. 在 P0 Gateway 上增加独立 DSH service，默认关闭。
2. 用户经过阻断式风险确认后，可从配对浏览器进入 DSH。
3. DSH `/api/<method>` 与两条 WebSocket 完整工作。
4. 多个远程页面可共享现有 singleton DSH backend，不改变 pane 生命周期。
5. DSH 暴露状态随 Runtime running/degraded/stopped/crashed 正确收敛。
6. DSH upstream 仍固定 `rc.6`；任何升级单独评审。

---

## 7. 非目标

### 7.1 第一、二阶段共同非目标

- 公网访问、NAT 穿透、端口转发、Tailscale、Funnel、Cloudflare Tunnel；
- HTTPS、自签证书安装、企业 CA；
- 完整 KickSide Web 控制中心；
- 多用户账号、SSO、组织权限和跨设备云同步；
- 永久设备信任或跨应用重启免配对；
- mDNS/Bonjour 自动发现；
- IPv6；
- Linux；
- 后台系统服务或电脑开机即共享；
- 在手机端安装 KickSide 原生应用；
- 把 Gateway 宣称为 sandbox 或只读层。

### 7.2 P0 特定非目标

- DSH 远程访问；
- Kimi Provider/API key 远程管理；
- Kimi 远程登录/登出；
- 默认远程 PTY；
- 默认任意本机文件浏览。

### 7.3 P1 特定非目标

- DSH RPC 方法级完整 RBAC；
- DSH 只读模式；
- DSH 多后端实例；
- DSH pin 自动跟随 latest；
- DSH Settings/credentials 的额外加密代理。

---

## 8. 产品信息架构

控制中心设置层新增一项：

```text
运行时与访问
├─ Kimi Code
├─ DeepSeek Harness
└─ 局域网访问
```

遵循 `DESIGN.md`：使用现有 `ControlCenterSettingsRow`、紧凑状态、分区 + row，不新增营销式大卡片。

### 8.1 关闭态

```text
局域网访问                     已停止
允许同一可信网络中的手机和电脑访问此设备。

[开启局域网访问]
```

附一行必要警告：

```text
仅在可信家庭或办公网络中使用。
```

### 8.2 开启前网卡选择

当只有一个合格网卡：直接选中并显示。

当有多个候选：

```text
选择共享网络
● Wi-Fi · Home · 192.168.1.23/24
○ Ethernet · 10.10.0.15/24

不显示 VPN、Docker、虚拟机和 link-local 候选，除非用户打开技术详情。
```

公共网络或无合格接口时，不直接启动；显示原因与解决动作。

### 8.3 运行态

```text
局域网访问                     运行中
Home Wi-Fi · 192.168.1.23

入口
http://192.168.1.23:43100
[显示二维码] [复制地址] [重新生成配对码]

共享内容
Kimi Code                      已共享
DeepSeek Harness               已关闭
远程终端                       已关闭

已连接设备
iPhone · Safari                刚刚
Windows · Chrome               12 分钟前
[撤销]

[停止局域网访问]
```

状态词必须来自设计系统允许集合：运行中、已停止、待配置、错误、可选、已信任。

### 8.4 QR 弹层

弹层内容只包含：

- QR；
- 8 位手动配对码；
- 过期倒计时；
- “手机需连接同一 Wi-Fi”；
- “不要在公共 Wi-Fi 使用”。

不显示 Kimi token，不把 QR 存为文件。

### 8.5 Portal

Portal 是轻量移动网页，不是 Tauri UI 镜像：

```text
KickSide
Bo-Laptop · Home Wi-Fi

Kimi Code
运行中
[进入 Kimi Code]

DeepSeek Harness
已关闭 / 运行中
[进入 DeepSeek Harness]

此页面只能在当前局域网访问。
[退出此设备]
```

---

## 9. 第一阶段功能需求：Kimi LAN Access

优先级：P0 必须；P0.5 可在 Beta 后补，但正式发布前需要明确状态。

| ID | 优先级 | 需求 | 验收要点 |
|---|---|---|---|
| FR-LAN-001 | P0 | LAN preflight：检测 bundled Gateway、候选私有 IPv4、network profile、端口范围与 Kimi Runtime | 结果可读；不启动公开 listener；无 secret |
| FR-LAN-002 | P0 | 显式开启/停止局域网访问 | 默认关闭；stop 后 listener/WS/session/child 全部消失 |
| FR-LAN-003 | P0 | 绑定具体接口 IP，而不是 `0.0.0.0` | 只监听选中 RFC1918 IPv4；来源默认限当前子网 |
| FR-LAN-004 | P0 | Portal、Kimi、预留 DSH 三端口由同一 sidecar 管理 | 端口冲突自动选受控范围内新 triplet；实际端口不持久化 |
| FR-LAN-005 | P0 | QR 一次性配对 Secret + 8 位手动码 | QR secret 256-bit、fragment 承载、5min、单次；手动码有限次尝试 |
| FR-LAN-006 | P0 | 配对成功签发短期 Gateway Session | HttpOnly/SameSite Strict/host-only；内存态；stop/exit/network change 失效 |
| FR-LAN-007 | P0 | Portal 展示 Runtime 状态和进入动作 | 不泄露 path、token、PID；未运行时给明确提示 |
| FR-LAN-008 | P0 | Kimi service ticket 与独立 Kimi Session | ticket 60s、单次、绑定 portal session/service/source；Kimi cookie 与 Portal cookie 分名 |
| FR-LAN-009 | P0 | Kimi Web 官方 token bootstrap | 只在 service connect 时从 token file 读取；URL fragment 内存生成；不日志/持久化 |
| FR-LAN-010 | P0 | Kimi HTTP 代理 | 保留方法、query、body、multipart、Range/ETag、流式响应；rewrites 精确 |
| FR-LAN-011 | P0 | Kimi WebSocket 代理 | `/api/v1/ws`、Cookie、Authorization、`kimi-code.bearer.*` 子协议与重连可用 |
| FR-LAN-012 | P0 | Kimi 默认危险路由策略 | PTY、shutdown、debug、远程 OAuth 与主机原生/任意文件操作默认拒绝，返回明确错误 |
| FR-LAN-013 | P0 | 远程终端高级开关 | 默认 false；开启需二次确认；设置只在当前 Gateway lifecycle 生效，P0 不持久化 true |
| FR-LAN-014 | P0 | 连接设备列表与撤销 | 显示 UA 摘要、IP、lastSeen、活跃连接；单个/全部撤销立即生效 |
| FR-LAN-015 | P0 | pairing/session 速率限制 | per-IP + global；失败不泄露 secret 是否接近正确 |
| FR-LAN-016 | P0 | Host/Origin/CSRF 防护 | Host 仅精确 IP+owned ports；Origin 同 authority；cross-site 请求拒绝 |
| FR-LAN-017 | P0 | 网络变化处理 | IP/interface/profile 变化立即停止共享、撤销 Session并提示重新开启 |
| FR-LAN-018 | P0 | Kimi Runtime 变化 reconcile | target 原子更新；旧 WS 关闭；浏览器收到重连/重新进入提示 |
| FR-LAN-019 | P0 | Gateway 崩溃可见 | 控制中心进入错误；不自动无限重启；可查看脱敏日志与重试 |
| FR-LAN-020 | P0 | Windows 防火墙诊断 | 识别 Private/Public；显示允许步骤；安装版规则状态可查 |
| FR-LAN-021 | P0 | macOS 入站诊断 | 显示 sidecar signature/build/channel 与防火墙提示；真实签名发布门 |
| FR-LAN-022 | P0 | 日志与诊断 | 不记录 headers/body/query/fragment/cookie/token；可导出 redacted 状态与错误码 |
| FR-LAN-023 | P0 | 应用退出/更新退出收口 | 先关闭 Gateway，再停止 Kimi/DSH/Bridge；无残留端口或 child |
| FR-LAN-024 | P0 | 移动端兼容 | iOS Safari、Android Chrome、桌面 Chrome/Edge/Safari 核心流程通过 |
| FR-LAN-025 | P0.5 | Windows installer 预置 Private+LocalSubnet firewall rule | NSIS/MSI 创建、升级保留、卸载删除；Public profile 不启用 |

### 9.1 Kimi 默认路由策略的产品语义

当路由被拒绝时，浏览器不能只看到通用 403。Gateway 返回：

```json
{
  "code": "E-LAN-POLICY-001",
  "message": "此操作默认不允许通过局域网访问。请在运行 KickSide 的电脑上完成。"
}
```

设置页只提供少数可理解的能力开关：

```text
允许远程终端               默认关闭
允许浏览本机目录           默认关闭
允许远程停止 Kimi          默认关闭
```

不要向用户展示几十条 API 路由。

---

## 10. 第二阶段功能需求：DSH LAN Access

| ID | 优先级 | 需求 | 验收要点 |
|---|---|---|---|
| FR-DSH-LAN-001 | P1 | 在现有 Gateway 中增加 DSH service | 不新增第二个 public gateway 进程；复用 pairing/session/audit |
| FR-DSH-LAN-002 | P1 | DSH 暴露默认关闭 | settings 默认 false；历史设置迁移不能自动开启 |
| FR-DSH-LAN-003 | P1 | 阻断式风险确认 | 明确可读写文件、执行 Bash、控制工作区；用户确认后当前 lifecycle 才开启 |
| FR-DSH-LAN-004 | P1 | DSH service ticket 与独立 DSH Session | 与 Portal/Kimi cookie 分名；可独立撤销 |
| FR-DSH-LAN-005 | P1 | DSH HTTP `/api/<method>` 代理 | application/json、body limit、Host/Origin rewrite、错误响应完整 |
| FR-DSH-LAN-006 | P1 | DSH 双 WebSocket 代理 | `/api/events.mux`、`/api/events.host` 同时稳定，断线后 generation 重建 |
| FR-DSH-LAN-007 | P1 | DSH 静态资源与 SPA fallback | 顶层加载、刷新、History、Settings、workspace/session 入口可用 |
| FR-DSH-LAN-008 | P1 | DSH Runtime 状态投影 | running/degraded 可进入；starting 显示等待；stopped/crashed 禁止签 ticket |
| FR-DSH-LAN-009 | P1 | 不改变 DSH lifecycle | 远程页面关闭不停止 backend；只有现有控制中心/应用退出停止 |
| FR-DSH-LAN-010 | P1 | 共享 singleton 后端 | 本地多个 pane + 多个远程浏览器使用同一 backend，不串改 pane metadata |
| FR-DSH-LAN-011 | P1 | DSH full-control 文案常驻 | Portal 与 Desktop 设置都显示风险，不提供“只读”标签 |
| FR-DSH-LAN-012 | P1 | DSH upstream contract gate | 以 KickSide pin rc.6 做 required E2E；rc.7/latest 仅观察，不改变发布结论 |
| FR-DSH-LAN-013 | P1 | DSH body/WS 资源约束 | 大图片/长任务不造成 Gateway OOM；连接数、body、header、idle timeout 有界 |
| FR-DSH-LAN-014 | P1 | DSH 审计 | 记录连接/状态/方法族，不记录 prompt、凭据或正文 |
| FR-DSH-LAN-015 | P1 | 一键停止 DSH 共享 | 只撤销 remote surface，不停止本地 DSH Runtime，除非用户另点停止实例 |

---

## 11. 非功能需求

### 11.1 安全

| ID | 需求 |
|---|---|
| NFR-SEC-001 | 所有 public listener 只绑定选中私有 IPv4，默认来源限同子网 |
| NFR-SEC-002 | Gateway admin API 只监听 loopback，并使用随机 admin token file |
| NFR-SEC-003 | secret 仅通过环境变量或 token file；禁止命令行明文 |
| NFR-SEC-004 | 配对/session/token/cookie 不进入 settings、Grid、locator、README、日志、诊断和 telemetry |
| NFR-SEC-005 | Go toolchain >=1.26.6，CI 执行 `govulncheck` |
| NFR-SEC-006 | 无 wildcard CORS；public Host/Origin 精确校验 |
| NFR-SEC-007 | 清除客户端提供的 Forwarded/X-Forwarded/X-Real-IP/Proxy-* 与 hop-by-hop headers |
| NFR-SEC-008 | Gateway upstream target 只接受 `http://127.0.0.1:<validPort>` |
| NFR-SEC-009 | 日志先 redactor 后落盘；请求体、Authorization、Cookie、WebSocket protocol 永不记录 |
| NFR-SEC-010 | 公共/未知网络默认拒绝开启；开发者 override 必须是当前 lifecycle 的显式动作 |

### 11.2 可靠性

| ID | 需求 |
|---|---|
| NFR-REL-001 | Gateway start 10s 内进入 running 或返回确定错误；不能无限等待 |
| NFR-REL-002 | stop 后 5s 内 listener 与 WS 关闭；8s 内 owned process tree 消失 |
| NFR-REL-003 | Kimi/DSH target 使用原子快照更新，不在半更新状态代理 |
| NFR-REL-004 | Gateway 不因单个 malformed request、WS 断线或 upstream 502 崩溃 |
| NFR-REL-005 | 单 client 不能耗尽全局连接、goroutine、header 或 body 内存 |
| NFR-REL-006 | 网络变化 fail closed：停止，而非猜测新接口继续共享 |
| NFR-REL-007 | Gateway crash P0 最多自动重启 1 次；再次失败进入 error，防止重启风暴 |

### 11.3 性能

| ID | 目标 |
|---|---|
| NFR-PERF-001 | Portal 首屏在正常 LAN 下 p95 < 500ms（不含扫码时间） |
| NFR-PERF-002 | Gateway 对普通 API 增加的服务端处理 p95 < 20ms |
| NFR-PERF-003 | 流式 assistant delta 的额外可感知延迟 p95 < 100ms |
| NFR-PERF-004 | P0 同时支持至少 5 个浏览器 Session、20 条 WS/HTTP 长连接 |
| NFR-PERF-005 | idle Gateway RSS 目标 < 80MiB；真实数据以 M0 基线校准 |

### 11.4 隐私

- 不把远程设备 IP、UA 或访问记录上传云端。
- 本地 audit 默认保留 7 天或 10MiB 轮转，取先到者。
- 诊断包对 IP 做部分脱敏，UA 只保留浏览器族和 OS 族。
- 不记录 prompt、assistant 内容、文件名、query string 或 session id 全值。

### 11.5 可访问性与本地化

- QR 之外必须提供可复制 URL 和手动码。
- 所有开关、警告、错误支持键盘 focus 和屏幕阅读器。
- 风险确认不能仅靠颜色。
- 中文为当前默认；技术值保持原文。
- Portal 在 320px 宽度可用，触控目标不小于 44px。

### 11.6 兼容性

发布级支持：

- Windows 10/11 x64 + Edge/Chrome；
- Apple Silicon macOS 13+ + Safari/Chrome；
- iOS/iPadOS Safari（具体最低版本由 M0 实测确定）；
- Android Chrome（具体最低版本由 M0 实测确定）。

Firefox 为 best-effort，若不列入 G3 不得宣称正式支持。

---

## 12. 状态与错误文案

### 12.1 用户可见状态

```text
已停止
正在启动（UI 可使用“正在开启”，但持久状态词不新增）
运行中
待配置
错误
```

### 12.2 错误码

| Code | 用户文案 | 典型原因 |
|---|---|---|
| E-LAN-001 | 未找到可共享的私有网络 | 无 RFC1918 网卡、只有 VPN/link-local |
| E-LAN-002 | 当前网络不适合开启局域网访问 | Windows Public profile、未知网络 |
| E-LAN-003 | 局域网端口不可用 | 端口范围耗尽 |
| E-LAN-004 | 局域网组件缺失或损坏 | sidecar 未打包、签名/版本不匹配 |
| E-LAN-005 | 局域网组件启动超时 | child/admin health 未就绪 |
| E-LAN-006 | 防火墙可能阻止其他设备连接 | Windows/macOS 入站限制 |
| E-LAN-007 | 配对码已失效 | 过期、已使用、尝试过多 |
| E-LAN-008 | Kimi Code 当前不可用 | backend stopped/crashed/token missing |
| E-LAN-009 | DeepSeek Harness 当前不可用 | disabled/stopped/crashed |
| E-LAN-010 | 网络已经变化，局域网访问已停止 | IP/interface/profile 改变 |
| E-LAN-011 | 局域网组件异常退出 | child crash |
| E-LAN-012 | 本地 Agent 服务连接失败 | upstream 502/WS failure |
| E-LAN-013 | 当前 Agent 版本尚未通过远程兼容检查 | contract mismatch |
| E-LAN-014 | 此操作不允许通过局域网执行 | route policy |
| E-LAN-015 | 当前设备 Session 已被撤销 | user revoke/stop |

---

## 13. 成功指标

以下指标只在用户选择匿名产品遥测时采集，且不得包含 IP、URL、UA、端口、工作区、token 或 session id。

### 13.1 激活

- 开启动作成功率 ≥ 90%；
- 首次开启到显示 QR 的中位时间 < 5s；
- 显示 QR 后 5 分钟内成功配对比例 ≥ 60%。

### 13.2 可用性

- 配对后的 Kimi 首次加载成功率 ≥ 90%；
- Kimi WS 建连成功率 ≥ 95%；
- Gateway 导致的 5xx 比例 < 1%；
- 正常 stop 后残留 listener/process 比例 = 0。

### 13.3 第二阶段

- 主动开启 DSH 的用户中，DSH 完整连接成功率 ≥ 85%；
- 双 WS generation 建立成功率 ≥ 95%；
- P1 发布前 required pin 的 E2E 通过率 = 100%。

### 13.4 安全与质量

- secret/token 日志泄露自动测试命中数 = 0；
- Public network 静默开启数 = 0；
- 未配对请求进入 upstream 数 = 0；
- Go/Rust/TS contract drift required gate 通过率 = 100%。

---

## 14. 发布策略

### 14.1 第一阶段

1. 开发者 flag：只在 dev/adhoc build；
2. Internal Alpha：Kimi proxy + 配对；
3. Beta：Windows/macOS installed build，设置页标注“局域网 Beta”；
4. 正式开放：双平台 G3、移动浏览器矩阵、installer firewall 与日志脱敏全部通过。

Beta 默认仍关闭，不做 onboarding 强推。

### 14.2 第二阶段

- 仅对已通过 P0 G3 的构建开放；
- DSH 开关标注“实验性 · 完整控制”；
- 默认 false；
- 每次新 Gateway lifecycle 第一次开启 DSH 都显示确认；
- required test 固定 KickSide pin `rc.6`；
- latest `rc.7+` 只作观察 lane；
- pin 升级需要独立 Research/ADR/Canary。

---

## 15. 验收标准

### 15.1 P0 产品验收

- [ ] 默认设置与旧用户迁移后 LAN Access 均为关闭。
- [ ] 用户选择一个私有 IPv4 后，只有该 IP 的三个受管端口在监听。
- [ ] 手机扫码可完成一次性配对，QR secret 不出现在 Gateway access log。
- [ ] Portal Session、Kimi Session 可分别撤销。
- [ ] Kimi 首页、会话列表、消息、流式输出、prompt、approval、upload/download、断线恢复可用。
- [ ] PTY、shutdown、debug、远程 OAuth 与默认高风险主机操作被拒绝。
- [ ] Kimi token 不进入 settings、Grid、locator、日志、诊断或 telemetry。
- [ ] 网络切换后 Gateway 停止，旧 Session 失效，旧 IP 不再监听。
- [ ] KickSide Quit / updater exit 后 Gateway 先退出，无 orphan。
- [ ] Windows Private 网络可用；Public 默认拒绝；防火墙拒绝有明确引导。
- [ ] macOS signed build 的入站提示、扫码和退出收口通过。
- [ ] iOS Safari、Android Chrome、Edge/Chrome/Safari 真机矩阵完成。

### 15.2 P1 产品验收

- [ ] DSH 默认不共享。
- [ ] 开启前出现明确 full-control 风险确认。
- [ ] DSH Portal ticket 与 Session 独立于 Kimi。
- [ ] `/api/<method>`、`events.mux`、`events.host` 均可通过 Gateway。
- [ ] 能创建/恢复会话、流式回复、调用工具、处理 approval、执行 Bash、刷新页面。
- [ ] 本地多个 pane 与至少两个远程浏览器共享 singleton backend，状态不串。
- [ ] 停止 DSH 共享只断远程 surface，不停止本地 DSH；停止 Runtime 则远程立即不可进入。
- [ ] KickSide pin `rc.6` required E2E 全绿；latest 失败不阻塞，required pin 失败必须阻塞。

---

## 16. 已收敛决策

| ID | 决策 |
|---|---|
| DR-P-01 | 新增独立 Go LAN Gateway sidecar，不扩展旧 workspace proxy |
| DR-P-02 | Kimi/DSH upstream 永久保持 loopback |
| DR-P-03 | 第一版局域网 HTTP + 明确信任前提，不做自签 HTTPS |
| DR-P-04 | 三端口而非 `/kimi`/`/dsh` 子路径 |
| DR-P-05 | P0 每次应用启动后手动开启，不自动在新网络恢复 |
| DR-P-06 | Session 第一版只保存在内存，不做永久设备信任 |
| DR-P-07 | Kimi 使用官方 token bootstrap，Gateway 不关闭 Kimi auth |
| DR-P-08 | DSH 默认关闭并视为 full-control surface |
| DR-P-09 | P0 IPv4 only；QR 优先，mDNS/UDP discovery 延后 |
| DR-P-10 | Windows正式安装版优先使用 Private+LocalSubnet 的 installer firewall rule |

---

## 17. 仍需 M0 关闭的问题

1. Kimi/DSH 当前 Web bundle 是否依赖 HTTP 私有 IP 下不可用的 Secure Context API？
2. iOS Safari 对三端口 HttpOnly Cookie、WS subprotocol、后台恢复的具体行为？
3. Kimi route deny list 在当前 bundle 中是否会导致设置页/文件选择器无限重试？
4. DSH rc.6 通过 ReverseProxy 时两条 WebSocket 是否需要额外 header/timeout？
5. Windows NSIS/MSI firewall rule 的精确安装/升级/卸载实现？
6. macOS 正式签名 nested sidecar 的 firewall identity 是否稳定？
7. 支持的最低 iOS/Android 版本应由哪些真实设备证据确定？

这些问题不会改变核心架构，但会决定 Beta 的支持矩阵和 release gate。
