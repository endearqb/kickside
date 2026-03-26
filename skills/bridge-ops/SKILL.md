---
name: bridge-ops
description: 处理 Feishu IM bridge 运维请求。读取当用户提到的让我选择对话，新建对话，让我看看有哪些对话，重启对话或者桥接上下文后，通过本 skill 自带的 PowerShell 脚本执行查看状态、列出 session、切换 session、重启 bridge 等本地 CLI 操作。
---

# Bridge Ops

这个 skill 只负责当前仓库里的 IM bridge 运维动作。

- 不恢复 Feishu `/bridge` 命令。
- 不依赖卡片回调。
- 不走适配层原生命令执行。
- 你必须通过本 skill 自带的 PowerShell 脚本完成操作。

## When To Use

当用户在 Feishu 里表达这些意图时使用本 skill：

- 查看当前 bridge / channel / binding / session 状态
- 列出可切换的 bridge sessions
- 切换当前聊天绑定到某个 session
- 重启 bridge

典型触发语句：

- `桥接：查看对话状态`
- `桥接：列出 sessions/对话`
- `桥接：切到 <session-id>`
- `桥接：重启`
- `查看当前 session/对话`
- `列一下 sessions/对话`
- `切到 <session/对话-id>`
- `重启对话`

## Supported Actions

只支持 4 个动作，且必须通过 `scripts/bridge_ops.ps1` 执行：

1. `status`
2. `list_sessions`
3. `switch_session`
4. `restart`

## Required Inputs

当消息 prompt 里存在下面这个上下文块时，读取它并把字段传给脚本：

```text
[bridge_context]
platform=...
chat_id=...
thread_id=...
binding_id=...
current_session_id=...
current_workdir=...
bridge_auth_file=...
[/bridge_context]
```

如果没有这个上下文块：

- `status` 仍可执行，但只能返回 bridge 全局状态和 session 列表，不能定位当前 binding。
- `list_sessions` 仍可执行。
- `switch_session` 不能执行，必须先说明缺少当前聊天上下文。
- `restart` 仍可执行，但需要先确认。
- 如果存在 `bridge_auth_file`，调用脚本时优先通过 `--auth-file` 显式传入，不要只依赖环境变量。

## Execution Rules

- `status` 和 `list_sessions` 直接执行。
- `switch_session` 和 `restart` 必须先确认，再调用脚本。
- 如果 `switch_session` 目标不明确，先运行 `list-sessions`，再根据返回结果让用户确认精确 session id。
- 不要编造 bridge 状态；必须以脚本返回的 JSON 为准。
- 不要调用 `/bridge` slash 命令。
- 不要依赖 Feishu 卡片按钮或回调。
- `KIMI_BRIDGE_AUTH_FILE` 只作为兼容兜底；真实执行时优先用上下文中的 `bridge_auth_file`。

## Commands

从当前 skill 目录运行下面的 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/bridge_ops.ps1 status --auth-file <bridge_auth_file> --platform <platform> --chat-id <chat_id> --thread-id <thread_id>
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/bridge_ops.ps1 list-sessions --auth-file <bridge_auth_file>
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/bridge_ops.ps1 switch-session --auth-file <bridge_auth_file> --platform <platform> --chat-id <chat_id> --thread-id <thread_id> --target <session-id-or-query>
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/bridge_ops.ps1 restart --auth-file <bridge_auth_file>
```

脚本会优先读取 `--auth-file`，其次读取 `KIMI_BRIDGE_AUTH_FILE`，最后尝试从本机默认 `com.kimi.shell` 配置目录发现 auth file。

## Diagnostics

如果需要在当前机器上确认实际 `bridge_auth_file` 路径，可先运行：

```powershell
powershell -NoProfile -Command "$candidates = @(); if ($env:KIMI_BRIDGE_AUTH_FILE) { $candidates += $env:KIMI_BRIDGE_AUTH_FILE }; if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'com.kimi.shell\bridge_skill_auth.json') }; if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'com.kimi.shell\bridge_skill_auth.json') }; $candidates | Where-Object { $_ } | Select-Object -Unique | ForEach-Object { [pscustomobject]@{ path = $_; exists = Test-Path -LiteralPath $_ } } | ConvertTo-Json"
```

如果返回里有 `exists: true`，优先使用那条路径作为 `--auth-file`。

## Reply Style

- 用中文回复。
- 结果简洁，优先给结论。
- `status` 要明确说出 bridge state、channel state、当前 binding、当前 session。
- `list_sessions` 要突出当前 session。
- `restart` 要明确提示 bridge 会短暂断开后重新拉起。
- 如果脚本返回错误或歧义候选，原样总结给用户，不要自行猜测。
