# Verification Gates

## Shell

```powershell
Set-Location apps/kimi-shell/src-tauri
cargo check
cargo test --no-run
```

```powershell
Set-Location apps/kimi-shell
.\node_modules\.bin\tsc.cmd --noEmit
```

## IM Bridge

```powershell
Set-Location apps/kimi-im-bridge
go test ./...
```

## Notes
- 当前 Windows 环境中 Rust test binary 运行阶段可能报既有 `STATUS_ENTRYPOINT_NOT_FOUND`；能运行时优先执行完整 `cargo test`。
- `pnpm exec` 可能触发非交互 install/purge 防护；本地已有 `node_modules` 时优先调用 `.\node_modules\.bin\tsc.cmd`。

## Manual Release Gates

P5 发布前仍需要人工或专用环境验证：

- Telegram 私聊/群聊 prompt、stream、approval 与 Bridge 重启后的 pending approval 恢复。
- Feishu DM/group/thread prompt、streaming card、approval card 与 Bridge 重启后的 pending approval 恢复。
- Weixin 若继续保留在发布范围内，至少验证最小 inbound/outbound 链路；当前不提供 in-chat approval callback。
- NSIS/MSI 安装版 Bridge lifecycle buttons、bundled sidecar 路径、token-file 启动和日志脱敏。
- 诊断包脱敏：server token、Bridge admin/host-control token、平台密钥和 API key 均不可见。
- OpenAPI/AsyncAPI 快照与回退路径在 CI 或发布脚本中固定。
