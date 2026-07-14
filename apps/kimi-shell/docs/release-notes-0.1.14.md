# Kimi Sidekick v0.1.14

## 后端启动更稳，诊断信息更清楚

这一版聚焦 Kimi Code 后端单实例兼容和小助手诊断体验：已有 Server 可以直接复用，Doctor 与日志也不再挤压其他设置内容。

## 这次更新带来了什么

- **复用已有 Kimi Server**：检测到同一 `KIMI_CODE_HOME` 下健康的 Server 时直接连接原端口，不再尝试启动第二个实例；退出小助手不会终止外部进程。
- **启动失败原因更准确**：区分单实例、健康检查、token、工作目录和命令启动错误，不再把所有 code 1 都归因于登录或 API 配置。
- **Kimi Doctor 独立展开**：Doctor 成为“小助手设置”中的独立折叠项，修复诊断页与其他设置详情重叠、遮挡和滚动错位。
- **后端日志更易排查**：`backend.log` 增加时间与启动 cycle 边界，并在继续写入前再次清理历史 token、API key 和带 `#token=` 的 URL。

## 安装

- Windows 推荐使用 NSIS：`kimi sidekick_0.1.14_x64-setup.exe`
- 企业部署或统一安装场景可使用 MSI：`kimi sidekick_0.1.14_x64_en-US.msi`

## 发布候选验证状态

- TypeScript 类型检查通过
- 前端测试：18 个测试文件、134 项通过
- Tauri 安全与窗口权限检查通过
- Rust `cargo check` 与测试编译通过
- 完整 Rust 测试需在干净 Windows CI 补跑，本机测试程序受 `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)` 阻塞
- NSIS/MSI、已有 Server 复用、退出后原 PID 保留及 1200px/760px 布局仍需发布环境验证
