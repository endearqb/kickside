# {{workspaceName}}

这是一个面向 Feishu IM bridge 运维的工作区。Agent 应优先读取本文件、`config/workspace.json` 和 `inbox/` 中的最新任务，再决定是否需要写入 `outbox/`。

## 工作约定

- `inbox/` 放外部输入、告警、人工指令和待处理材料。
- `outbox/` 放回复草稿、操作记录和需要人工确认的输出。
- `config/` 放非敏感运行配置；密钥、令牌和私密凭据不得写入仓库文件。
- `skills/` 放本工作区专属 skill 或 skill 说明。
- 默认先诊断，再执行；涉及外部系统写操作时必须说明影响范围。
