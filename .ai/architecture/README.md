# Architecture Facts

> 类型：contract
> Canonical sources：`apps/kimi-shell/src-tauri/src/backend_manager/lifecycle.rs`、`apps/kimi-shell/src-tauri/src/token_resolver.rs`、`apps/kimi-im-bridge`

## 职责
- 记录 Agent 动手前需要确认的当前架构事实、边界和验证入口。
- 不替代源码、测试、OpenAPI 或迁移脚本；事实冲突时以可执行契约和源码为准。

## 主题入口
- 当前事实与缺口：`current-state.md`
- Kimi Web DOM 与响应式注入契约：`kimi-web-dom-contract.md`
- 验证命令：`verification-gates.md`

## 已知缺口
- `dependency-boundaries.md`、`module-map.md`、`authorization-ontology.md` 尚未补齐。
