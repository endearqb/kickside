# Rust 参考实现

- `workspace_open_queue.rs`：把启动期单一 `Option<PendingWorkspaceBootstrap>` 改造成有序、去重、有界的 FIFO 思路。
- `context_menu_install_state.rs`：将“用户期望启用”与“注册表当前健康度”分开，修复禁用后下次启动又自动启用的问题。
- `explorer_open_integration_example.rs`：展示应用已运行时应如何调用现有 `create_workspace_session_for_grid`，而不是修改全局 cwd 并重启后端。
- `windows_shell_notify.rs`：注册表写入/删除后通知 Explorer。接入时需给 `windows` crate 增加 `Win32_UI_Shell` feature。

`explorer_open_integration_example.rs` 依赖本次建议新增的少量类型/发布函数，属于集成示例；完整差异见 `patches/`。本包没有本地完整仓库与 Rust toolchain，因此没有声称通过 `cargo check`。
