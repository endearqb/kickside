# kimi-app Explorer 右键菜单与 Pane Shelf 审查包

本包针对 `endearqb/kimi-app` 提交 `c2aaa14b9891c7de31363610d643ba70fa95c1e4`，包含：

- 当前应用冷启动/已运行时 Explorer 右键行为梳理；
- 18 项问题与 bug、严重度、影响和修复方案；
- `new_pane` session 路由与“六个可见 + Pane Shelf”设计；
- 可独立验证的 TypeScript placement/dedupe/session 路由代码；
- Pane Shelf React/CSS 参考实现；
- Rust 请求 FIFO、菜单期望状态和 Shell notify 参考代码；
- 四份集成补丁、Windows 检查脚本和完整测试矩阵。

## 首先阅读

1. `docs/REVIEW.md`
2. `README_APPLY.md`
3. `docs/TEST_MATRIX.md`

## 核心结论

当前 Explorer open 会在热启动时修改全局 cwd 并重启整个后端，随后前端覆盖当前/第一个 Code pane。正确方向是复用已有 runtime API 创建唯一 session，并携带 `disposition=new_pane`；六窗满时将新 pane 换入 active slot，把旧 pane 收纳到 Pane Shelf。

本包没有向 GitHub 创建分支、提交或 PR。
