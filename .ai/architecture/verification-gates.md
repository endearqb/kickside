# Verification Gates

## Shell

```bash
cd apps/kimi-shell
node scripts/build_bridge_sidecar.mjs
cd src-tauri
cargo fmt --all -- --check
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

```bash
cd apps/kimi-shell
pnpm exec tsc --noEmit
pnpm test
pnpm check:nfr:security
node --test scripts/generate_updater_manifest.test.mjs
```

## IM Bridge

```bash
cd apps/kimi-im-bridge
go vet ./...
go test ./...
go test -race ./...
```

## Notes
- 当前 Windows 环境中 Rust test binary 运行阶段可能报既有 `STATUS_ENTRYPOINT_NOT_FOUND`；能运行时优先执行完整 `cargo test`。
- `pnpm exec` 可能触发非交互 install/purge 防护；本地已有 `node_modules` 时优先调用 `.\node_modules\.bin\tsc.cmd`。
- Apple Silicon 本机开发包使用 `pnpm tauri:build:macos:local`；该命令只验证可构建/可启动 `.app`，不授权 Developer ID、notarization 或 updater 发布结论。
- PR CI 必须实际执行 `cargo test --locked`，不能以 `--no-run` 代替；macOS PR job 必须上传经过 `plutil`/`lipo` 校验的 unsigned `.app` artifact，但该 artifact 不代表签名或公证通过。

## Manual Release Gates

P5 发布前仍需要人工或专用环境验证：

- Windows 未登录状态启动或在 Kimi Code Web 触发 OAuth，系统默认浏览器必须打开验证页；完成验证并刷新后，控制中心仍能展示 `authMode`、Kimi 登录健康、Provider API 健康及诊断摘要。
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
- macOS arm64 `.app` / DMG 必须在干净账户验证 traffic lights、App/Edit/Window 菜单、关闭隐藏、Dock reopen、Cmd+Q owned runtime 收口、OAuth 跳转、WebSocket、下载、文件选择和中文 IME。
- 常规 macOS 公开发布必须针对最终 DMG 内的 app 通过 `codesign --verify --deep --strict`、`spctl --assess`、notarization 与 stapling；Developer ID certificate、Apple ID app-specific password 与 Team ID 只存 Actions Secrets。`0.1.24` 临时未签名例外改为 CI 验证 `.app` 仅含 ad-hoc signature 且无 Apple signing authority，并在 Release 顶部标注“⚠️ macOS 版本未签名”；该例外不授权任何 Gatekeeper 或生产就绪结论。
- GitHub Release 必须同时包含 Windows updater、macOS `.app.tar.gz`、两端 `.sig`、DMG 及同时含 `windows-x86_64`/`darwin-aarch64` 的唯一 `latest.json`；任一 build job 失败时 draft 不得发布。
