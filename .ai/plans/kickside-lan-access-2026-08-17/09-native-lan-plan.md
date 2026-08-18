# Plan · Kimi Native LAN Access

## 实施清单

- [x] 回退 `apps/kickside-lan-gateway`、Gateway CI 与验证门接线。
- [x] 旧 Gateway ADR/文档降级为 future alternative；接受 Native LAN ADR。
- [x] 增加非持久 LAN runtime state 与 local/LAN argv。
- [x] 拆分 external loopback reuse 与 owned wildcard probe 边界。
- [x] 增加 running session 拒绝、事务重启和失败回滚。
- [x] 增加私有 IPv4 枚举、普通状态与按需 launch URL/QR IPC。
- [x] 增加控制中心设置行、可信网络提示、复制地址与二维码。
- [x] 完成 Shell 全量 Rust/TS/React G1。
- [ ] 完成真实 macOS owned runtime 开关与回滚 smoke。
- [ ] 用户在 Windows 完成 G3：开/关监听、Private/Public firewall、手机/电脑访问、应用重启默认关闭、external runtime never-kill。
- [ ] 在 iOS Safari/Android Chrome 或实际目标移动设备完成扫码、REST、WS、prompt/stream 验证。

## G3 手工清单

1. 开启前确认 owned Kimi 仅监听 loopback；开启后确认同一端口监听 wildcard且本机 workspace 仍可用。
2. 同一可信 LAN 设备扫码，验证 auth、session list、prompt 与 WS stream；不要使用公共 Wi-Fi。
3. 关闭后确认 LAN IP 连接失败、loopback 恢复；应用退出重启后仍为关闭。
4. running session 切换必须拒绝；故障注入启动失败后必须恢复旧模式或明确报告双重失败。
5. external runtime 页面必须禁用开关，进程 PID 不变。
6. Windows 只允许用户选择专用网络；Public profile 阻断不视为应用失败。macOS 记录 Application Firewall 提示与入站结果。

## 完成边界

当前自动化通过只授权“已实现/对应 G1 已验证”；Windows/macOS/移动真机清单未完成前不得声明已发布。
