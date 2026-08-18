# M0 可行性核验记录

> **状态：历史证据档案。** 该记录对应已回退的 LAN Gateway spike，不能作为 Native LAN 当前实现或发布证据。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-17（证据更新至 2026-08-18） |
| 状态 | 架构可行；M0 部分已验证；P0 Go/No-Go blocked |
| 基线 | KickSide `main@a9c916e60d1cce113c644dbb4adf51f530bb7959` · Kimi Code 0.36.1 · DSH 0.1.0-rc.6 |

## 结论

独立 Go Gateway、loopback upstream、Host/Origin rewrite、Kimi bearer + WebSocket subprotocol、DSH `/api/<method>` + 双 WebSocket 的核心架构已由 fake 与本机真实 Runtime spike 证明可行。

P0 仍不能判定发布 Go：iOS Safari、Android Chrome、Developer ID 签名 macOS、外部设备入站、网络切换/sleep，以及完整 Kimi prompt/stream/approval 与 DSH tool/approval/Bash 尚未取得计划要求的证据。Windows Private/Public firewall 与安装验证由用户明确转交其 Windows 系统执行，不再作为当前 Agent 开发目标的等待条件；在用户回填证据前仍不能宣称 Windows G3 或双平台发布完成。

## 已验证

- 仓库 HEAD 与文档基线一致；实施前无既有 LAN Gateway 代码。
- Gateway 最小 Go module、`--version` 与无 public listener 的 `probe --json` 已实现。
- probe 在当前 macOS 主机只返回一个合格 RFC1918 接口，虚拟/隧道接口未取得 preferred authority。
- fake Kimi：REST、即时流式、Range、multipart、redirect、保留 Cookie 过滤、Host/Origin/Referer rewrite、forwarded header 清理、WebSocket subprotocol 均通过。
- fake DSH：`/api/host.describe`、`/api/events.mux`、`/api/events.host` 均通过。
- 真实 rc.6 纠正文档假设：`POST /api` 返回 404，`POST /api/host.describe` 返回 200；后续 fixture 以 `/api/<method>` 为 canonical path pattern。
- Go HTTP client 三端口集成 spike 已通过：QR secret 与手动码、Portal Session、Kimi/DSH ticket 与独立 Cookie、single-use/replay/source/service 绑定、Host/Origin/RemoteAddr guard、revoke/stop 主动关闭 WebSocket。该证据不等同于 Chrome/Safari 浏览器验证。
- Codex 内置浏览器已在精确私网 IPv4 HTTP origin 上真实完成 Portal → Kimi → Portal → DSH → Portal 的跨端口 top-level ticket/connect 流程；ticket fragment 在两个 service connect 后均已清除，三个 Session Cookie 在跨端口导航中可用且 `document.cookie` 为空，停止后 43100/43101/43102 全部释放。Chrome 控制扩展在真正导航前以 `ERR_BLOCKED_BY_CLIENT` 拦截同一私网 URL，Safari 26.5 WebDriver 明确要求用户先启用 Allow remote automation，因此两者仍未验证。因内置浏览器未宣告 family，本证据不冒充 Chrome、Safari、移动端或外部设备入站。
- Stop/Rotate 与 Stop/Revoke/Redeem 并发测试证明已停止 manager 不会复活 pairing、Session、ticket 或连接；reserved JSON 第二值、64KiB 超限、双凭证与缺失安全头均有回归。
- Session primitive 已增加 8 小时 absolute + 30 分钟 idle expiry、source + UA family 绑定、Session/Ticket/active connection 的 per-client/global 硬容量与有界清扫；三端口 handler 已切换到强绑定 API，UA family 不匹配会拒绝。
- 本机真实 Kimi 0.36.1 经 Gateway 通过 root、未认证拒绝、Bearer API 与 `kimi-code.bearer.*` WebSocket handshake。
- 本机真实 Kimi 0.36.1 经 Gateway 完成固定非敏感小 fixture 的 multipart upload、完整 download、Range `206` 与 DELETE cleanup；fixture 未进入模型且未读取用户文件。
- Kimi opt-in live E2E 已建立空临时 cwd、manual + Bash-only、WS hello/subscription、approval 只拒绝、abort/archive 与唯一 marker recovery 的 fail-closed 契约。前两次受控真实 prompt 因 harness 错把 0.36.1 顶层 `turn.started` / `assistant.delta` / `prompt.completed` 当作 `event.*` 而 timeout；此后以官方 0.36.1 package 逐步修正事件类型、必填 `client_id`、精确 ack/resync、default-model/catalog preflight、allowlisted `turn.ended.error.code`、`tool.list.updated` metadata，以及 `tool.call.delta` 先于完整 `tool.call.started` 的流式顺序。当前合成协议普通测试 20 次/race 5 次通过，能以首个 Bash delta 绑定 call ID，并继续拒绝非 Bash、多调用、ID 漂移、approval 前 progress/shell 与未知 tool event。累计提交 8 个受控 prompt session；本轮 5 个中首个明确 `model.not_configured`、未进入 provider，随后 4 个进入生成并可能产生少量 provider token/quota 成本，均在 harness 协议差异处 fail closed；所有本轮 marker session 均由 recovery 精确归档，始终未发送 approved，未取得 Bash 执行证据。完整成功 stream/approval-rejected 仍需按最新顺序再验证。最早一次旧版本没有 marker，仍保留一个归档状态未知的测试 session，其临时 cwd 已删除。
- 本机真实 DSH rc.6 经 Gateway 通过 `host.describe` 与同时建立 `events.mux` / `events.host`。
- 隔离 DSH rc.6 live E2E 已通过 owned runtime、Gateway、两个逻辑客户端、四条下行 WS、session create/history 与真实 `POST /api/commands/execute` permission slash；这纠正了把 slash 当作 `session.prompt` 的契约误判。测试进程未获 provider credential，普通 prompt 在生成前 fail closed，模型成本为 0，未产生 Bash/tool/approval/marker；进程树、端口、独立 `DSH_HOME`、session log 与 probe-root 均确认无残留，用户既有 DSH 未被读取或修改。
- 隔离安装的 DSH rc.7 通过现有 runtime smoke（ready、owned stop、port closed），并经同一 Gateway live test 通过 `/api/host.describe` 与同时建立 `events.mux` / `events.host`；项目 pin 保持 rc.6。
- Kimi 0.36.1 受鉴权 OpenAPI inventory 已固定为 100 条 method + templated path，fixture 与实时契约 100/100 匹配；shutdown、terminal、OAuth 控制、Provider 写入、host filesystem/native UI 已分类，debug 在当前 OpenAPI 中明确 absent 但分类器仍永久拒绝，未知写路由 fail closed。
- 新增唯一 `policy.Enforce` 执行边界：只有 reviewed allow route 可触达 next；review、deny、inventory error、未知读写、高风险与 debug 均 403，测试证明 upstream 零触达。
- 新增 M0-only、不可拆分的 `gateway.NewSpikeServiceHandler`：固定 exact guard → source/UA bound service session → reserved deny/Kimi allow-only policy → resource limiter → real connection registry → loopback proxy。Kimi/DSH 分别使用 256MiB/192MiB streaming body cap、40/Client 与 200/global 并发门；已知超限 body 在 upstream 前 413，chunked body 不会把越界字节转发。它不接 Tauri/设置/用户入口，M1 必须在硬门后 ratify。
- Kimi 0.36.1 非 OpenAPI 的 `/api/v1/ws` 仅以 exact GET、完整 RFC 6455 upgrade headers 与单一 `kimi-code.bearer.*` 作为 pin-protected exception；畸形或相似路径均 403。真实 Kimi/DSH ReverseProxy upgrade 已证明登记到同一 Session connection registry，revoke/stop 会关闭实际 proxy tunnel。
- Go 1.26.5 可执行 vet、test、race；但固定 `govulncheck@v1.7.0` 命中 4 个可达标准库漏洞，因此不能通过安全门。
- Go 1.26.6 下 vet、全量 test、race 与固定 `govulncheck@v1.7.0` 均通过，扫描结果为 `No vulnerabilities found.`；S0-06 本地 G1 已关闭。
- CI 已增加 Windows/macOS vet/test/CLI smoke，以及 Ubuntu race + 固定 govulncheck lane；Gateway runtime gate 已提高到 Go 1.26.6。
- 本机已将 `CGO_ENABLED=0` 的 darwin/arm64 Gateway 构建为原生 Mach-O，完成 ad-hoc `codesign`、strict verify 与签名后二进制 `--version` smoke；该证据只证明独立 nested binary 的基础签名兼容，不替代 Developer ID、app bundle nested signing、公证、Gatekeeper 或防火墙提示。

## 产品接入前安全阻断项

当前 CLI 只暴露 `--version` 与无监听的 `probe`，因此下列项不是已发布漏洞，但在任何 RFC1918 listener 接入前均为 P0：

- M0 listener spike 必须只挂载已实现的 `gateway.NewSpikeServiceHandler`；裸 `proxy.Handler` 继续仅限 contract/live tests，不能成为产品入口；正式 M1 constructor 尚未取得实现权限。
- Test-only 三端口 spike 已落实 Portal 20/client + 200/global，并固定 Portal 32KiB/5s/60s、Kimi/DSH 64KiB/10s/120s 的 header/read-header/idle 参数；service 40/client、global 200、Kimi 256MiB/DSH 192MiB streaming body 与真实 proxy WebSocket registry 已在 composed service handler 关闭。尚缺的是把这些边界与 `NewSpikeServiceHandler` 一并 ratify 为正式 M1 产品 listener，而不是更多 M0 primitive。

已在 M0 primitive 层关闭的审查项包括 Session/Ticket/connection store 硬容量、idle/absolute expiry、source+UA binding、有界清扫、route policy 的唯一 allow-only enforcement API，以及不可拆分的 service composition/resource/real-upgrade registry。

## 安全下限修正

原 research 以 GO-2026-4976 为依据，将 Go 下限设为 1.26.3。M0 在 Go 1.26.5 上发现以下可达问题，扫描均给出 Go 1.26.6 修复版本：

- GO-2026-6090：`crypto/tls` post-handshake message limit；
- GO-2026-6089：`net/http` unencrypted HTTP/2 read-header timeout；
- GO-2026-5972：`encoding/asn1` recursion depth；
- GO-2026-5026：`net/http` / IDNA Punycode label handling。

因此 ADR、research、PRD、spec、plan 与 executable gate 的最低版本统一为 Go 1.26.6。主机已通过 Go 官方模块工具链取得 1.26.6 并关闭本地安全门；`go.mod` 仅保留 `go 1.26.6`，避免同版本冗余 `toolchain` 指令触发 `go mod tidy` 漂移，runtime floor test 与 CI 仍 fail closed。

## 当前 blocked 条件

| M0 项 | 当前状态 | 解除条件 |
|---|---|---|
| S0-06 Go 安全工具链 | 已验证（本地 G1） | CI 在 Windows/macOS/Ubuntu 重放既有 lane |
| S0-07 Kimi 真实完整流程 | root/auth/WS/upload/download/range 已验证；default model/catalog、error code、tool list 与 delta→started 顺序已按 0.36.1 纠正并通过合成回归；所有本轮 marker 已归档、无 approved/Bash 证据 | 以最新 harness 补成功 stream/approval-rejected 与 Kimi SPA top-level；首次无 marker 测试 session 仅可人工识别归档 |
| S0-08 移动 HTTP | blocked | iPhone/iPad Safari 与 Android Chrome 真机 |
| S0-09 三端口配对 | Go client + Codex 内置浏览器已验证；Chrome/Safari/mobile blocked | 在桌面 Chrome/Safari、iOS Safari 与 Android Chrome 验证跨端口 Cookie/ticket/bootstrap |
| S0-10 DSH 真实完整流程 | 双客户端/四 WS/session/history/permission slash 已验证；无 provider 时生成前 fail-closed | 在仅向隔离测试进程提供 provider credential 的环境补 model stream、Bash denial→相同命令 escalation→allowed-once→duplicate not-pending |
| S0-11 rc.7 观察 | 核心协议 observation 已验证 | 扩展 session/tool/Bash 后生成完整 compatibility diff；不得改变 rc.6 pin |
| S0-12 Windows firewall | 用户负责、移出当前 Agent 测试范围 | 用户在 Windows 10/11 完成 Private/Public/allow/block、安装与进程树证据并回填；此前不得宣称 Windows G3 |
| S0-13 macOS 签名/firewall | 独立 arm64 Gateway ad-hoc sign/strict verify/CLI smoke 已通过；发布链 blocked | Developer ID app bundle nested sidecar、notarization、Gatekeeper 与外部设备入站 |
| S0-14 network/sleep | blocked | Windows/macOS 各完成 stop/revoke/端口残留验证 |
| S0-15 Kimi route inventory | 已验证（定向 G1） | Kimi pin 升级时按 fixture digest 重跑差异审查 |

## 可复现命令

```bash
cd apps/kickside-lan-gateway
go vet ./...
go test ./...
go test -race ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.7.0 ./...
```

真实 Runtime 测试是 opt-in；target 只能是精确 loopback HTTP，token 只通过受控 token file 传入。命令、日志和本记录均不写明 token 值、完整 WebSocket subprotocol、Cookie 或本机 token file 路径。
