# Kimi Sidekick v0.1.15

## 修复更新后 stale lock 阻塞启动

- 修复旧后端已退出、Kimi Server lock 未及时清理时，小助手误报“健康检查失败”并停在 Doctor 的问题。
- 本机端口明确连接失败时，现在会将 lock 识别为过期并继续正常启动新后端。
- 健康实例复用、Bearer 验证以及 HTTP 4xx/5xx、超时等真实故障处理保持不变。

## 安装

- Windows NSIS：`kimi.sidekick_0.1.15_x64-setup.exe`
- Windows MSI：`kimi.sidekick_0.1.15_x64_en-US.msi`

## 验证

- Rust 格式检查与 `cargo check` 通过。
- Rust 测试目标编译通过；完整测试需在干净 Windows CI 补跑，本机测试程序仍受 `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)` 阻塞。
