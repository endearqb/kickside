# Repo overlay

这些文件按 `kimi-app` 仓库相对路径摆放，方便复制/比较。它们不是完整 checkout，也不会直接替换现有文件：

- 前端三个纯逻辑文件可直接新增；`PaneShelf.tsx/.css` 需要按 patch 3 接入 store/titlebar。
- Rust 文件是可拆入现有模块的参考实现；需在完整 checkout 中补 `mod`、类型导入和现有 API 适配。
- 不要把 overlay 整体覆盖到仓库后直接提交；先阅读 `README_APPLY.md` 并运行 `git apply --check`、`pnpm build`、`cargo check` 和 Windows 手测。
