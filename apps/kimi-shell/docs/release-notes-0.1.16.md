# Kimi Sidekick v0.1.16

## Agent Room V1（默认关闭）

- 新增本地原生 Agent Room Pane，可从 1–6 个 Code Pane 发现、去重、观察并准确打开实际 Kimi Code Session；Room 仅保存协作投影与引用，不复制完整对话。
- 新增 Agent、Room、Member、Message、Run、Event、Queue、Lease、Approval、Workflow 与 Connector Binding 的持久化及恢复；正向调度严格保持单 Session 单执行所有者，未确认 Abort 不会提交替代任务。
- 支持 `@Agent`、多目标、`@all`、Pane Session 加入/跟随/固定、Parallel Review 与显式有界 Workflow。
- Agent Profile 与外部 IM Connector 凭据解耦；飞书群聊只响应对本机器人 Open ID 的精确 mention，并忽略 bot/app/self sender。
- 该功能继续由默认关闭的 `KIMI_AGENT_ROOM_ENABLED` 保护。真实 Runtime 当前需配置可用 model；真实飞书多机器人、微信共存、签名 updater 和安装升级生命周期仍须在带隔离凭据、签名密钥及 Windows 测试机的发布环境补齐 G3，不在本地验证范围内。

## 彻底规避 stale lock 阻塞启动

- 保留健康与 Bearer 验证，健康的外部 Kimi Server 仍会安全复用。
- localhost 探测显式禁用代理，避免本机请求受代理配置影响。
- 连接拒绝、发送失败或超时等未收到 HTTP 响应的情况不再阻塞启动，而是交由 Kimi 官方 `server run` 安全处理 stale lock。
- HTTP 4xx/5xx 等真实服务响应仍会显示准确故障，不会被误判为 stale。

## 安装

- Windows NSIS：`kimi.sidekick_0.1.16_x64-setup.exe`
- Windows MSI：`kimi.sidekick_0.1.16_x64_en-US.msi`

## 验证

- Go 全量测试、Rust 235 tests、前端 175 tests、类型检查与 capability/resource/167-command ACL Gate 通过。
- 本地生成并核对 `0.1.16` NSIS/MSI，bundled sidecar 通过 token-file 启动、Admin health、数据库创建与日志脱敏 smoke；当前本地产物未签名，不等同于已发布。
- 使用 dead PID stale lock 执行安装版更新启动 smoke，无需手动删除 lock 即可进入 Running。
