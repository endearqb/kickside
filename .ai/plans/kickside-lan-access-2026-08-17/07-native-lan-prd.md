# PRD · Kimi Native LAN Access

## 目标

让用户在可信家庭或办公局域网中，用手机或其他电脑直接访问 KickSide 管理的 Kimi Code，同时保持 Bearer Token、默认安全路由和应用重启后的本机安全默认值。

## P0 范围

- 控制中心提供“局域网访问”开关；关闭为默认 loopback，开启为 `--host 0.0.0.0`。
- 开关只作用于 `OwnedByShell` Kimi，外部复用实例只解释原因、不终止。
- 切换会受控重启；存在 running session 时拒绝；失败自动恢复旧模式。
- 展示过滤后的私有 IPv4 和无 token 地址。
- 用户显式点击后才临时生成完整 launch URL 或二维码。
- UI 明示 HTTP、可信网络、任务中断、防火墙/AP Isolation 与局域网模式下 PTY 不可用。
- 每次 KickSide 进程启动默认关闭，不新增设置 schema。

## 非目标

- DSH 局域网访问；LAN Gateway；设备配对；Cookie；REST/WS 代理。
- 自动防火墙规则、HTTPS、mDNS、公网、Tailscale、持久可信网络。
- 远程 terminal、shutdown、debug 或 auth bypass。

## 验收

- 自动化：local/LAN argv、外部 wildcard 拒绝、owned wildcard 精确放行、running session 拒绝、切换失败回滚、URL 按需生成、token 不进入普通状态/日志/持久化。
- G3：macOS 与 Windows owned runtime 开关；同一 LAN 的手机/电脑扫码访问；应用重启恢复关闭；外部 runtime 不受影响；防火墙阻断时提示可理解。
