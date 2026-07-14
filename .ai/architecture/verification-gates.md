# Verification Gates

## Shell

```powershell
Set-Location apps/kimi-shell/src-tauri
cargo check
cargo test --no-run
```

```powershell
Set-Location apps/kimi-shell
pnpm test
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
- 日志与诊断脱敏：`backend.log`、`app.log`、诊断页复制内容和诊断包中，server token（含 URL 编码形式）、Bridge admin/host-control token、平台密钥和 API key 均不可见。
- OpenAPI/AsyncAPI 快照与回退路径在 CI 或发布脚本中固定。
- 从旧 NSIS 安装版验证：检测新版本、下载进度、签名校验、Kimi 后端/IM Bridge 停止、`passive` 安装和新版本启动。
- 从旧 MSI 安装版重复同一链路，确认 installer-specific `latest.json` 条目沿用 MSI；缺少专用条目时 legacy Windows 回退指向 NSIS。
- 断网、下载失败或损坏签名必须保留当前安装，且检查/下载失败前不得停止后端或 Bridge。
- GitHub Release 必须同时包含 NSIS/MSI、对应 `.sig` 和可解析的 `latest.json`；tag 必须与 `apps/kimi-shell/package.json` 版本一致。
- `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 只在仓库 Actions Secrets 中配置；发布日志和资产不得泄露密钥内容。
