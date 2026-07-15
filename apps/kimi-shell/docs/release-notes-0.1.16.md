# Kimi Sidekick v0.1.16

## 彻底规避 stale lock 阻塞启动

- 保留健康与 Bearer 验证，健康的外部 Kimi Server 仍会安全复用。
- localhost 探测显式禁用代理，避免本机请求受代理配置影响。
- 连接拒绝、发送失败或超时等未收到 HTTP 响应的情况不再阻塞启动，而是交由 Kimi 官方 `server run` 安全处理 stale lock。
- HTTP 4xx/5xx 等真实服务响应仍会显示准确故障，不会被误判为 stale。

## 安装

- Windows NSIS：`kimi.sidekick_0.1.16_x64-setup.exe`
- Windows MSI：`kimi.sidekick_0.1.16_x64_en-US.msi`

## 验证

- Rust 格式检查、编译与测试目标编译通过。
- 使用 dead PID stale lock 执行安装版更新启动 smoke，无需手动删除 lock 即可进入 Running。
