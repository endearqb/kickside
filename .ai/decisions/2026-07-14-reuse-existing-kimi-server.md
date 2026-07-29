# Reuse Existing Kimi Server

## Status

Accepted

## Decision

- Kimi 小助手启动时优先读取同一 `KIMI_CODE_HOME` 下的 `server/lock`，并在本机地址、端口、健康检查和 server token 验证通过后复用已有 Kimi Server。
- `kimi_runtime_locator.json` 的 `ownership` 增量增加 `reused_external`；Shell 自己启动的实例继续使用 `owned_by_shell`，无可用实例使用 `unavailable`。
- Shell 退出、普通停止和重新连接不得终止 `reused_external` 实例；只有 `owned_by_shell` 实例由 Shell 子进程生命周期管理。
- 用户明确确认的 Kimi Code 升级或卸载任务是唯一例外：任务可先执行官方兼容的 Server 停止命令，避免 Windows 原生 `kimi.exe` 被外部实例锁定。
- 复用验证失败时不自动执行 `kimi server kill`，而是返回包含 PID、端口和失败原因的可操作错误。

## Rationale

- Kimi Code 0.23.6 使用每个 `KIMI_CODE_HOME` 一个 Server 的单实例模型；为随机空闲端口启动第二个 Server 会因既有 lock 直接退出。
- 自动终止已有实例会中断 CLI、浏览器或其他客户端；复用官方 lock、token 和健康端点能恢复启动且不破坏外部工作。
- 显式所有权使停止、监控和 Bridge runtime locator 不再依赖 `child` 是否存在来猜测进程归属。

## Consequences

- `server/lock` 按宽松 schema 读取，未知字段被忽略；只有本机地址和验证通过的实例可复用。
- 复用实例由健康探测监控，但不会被 Shell 的退出协调终止；“重启后端”在该状态下表现为重新连接。
- 应用内升级开始前必须明确告知会中断当前 Kimi Server 连接；取消确认不得停止实例或启动安装任务。
- `reused_external` 是 locator 序列化契约的增量值；Bridge 继续以 `origin`、`tokenPath` 和 `health` 为运行条件。
- 除已确认的升级/卸载外，需要强制终止外部实例时，用户必须在 Shell 外显式执行 `kimi server kill`。

## Verification

- Rust 测试覆盖 lock 解析、地址/端口校验、健康与 token 验证、竞态复用、所有权序列化以及停止不终止外部实例。
- 安装管理测试覆盖 Windows 原生升级分支的兼容停止、官方脚本调用和版本验证。
- G3 smoke 先启动官方 Kimi Server，再启动和退出小助手，确认复用原端口且原 PID 保持运行。
