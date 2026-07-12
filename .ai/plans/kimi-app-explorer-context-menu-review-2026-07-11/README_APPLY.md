# 如何使用本审查包

## 建议顺序

1. 在干净 checkout 中确认基线：

   ```bash
   git rev-parse HEAD
   # 本包审查基线：c2aaa14b9891c7de31363610d643ba70fa95c1e4
   ```

2. 先阅读 `docs/REVIEW.md`，确认产品决策：六个是可见上限，总上限默认 12；第七个 pane 自动换入 active slot。
3. 本包只有 `patches/0000-add-pane-shelf-reference-files.patch` 是标准的“新增文件”补丁，可先检查：

   ```bash
   git apply --check patches/0000-add-pane-shelf-reference-files.patch
   ```

4. `*.integration.diff` 是带上下文的人工接线参考，不应直接当成可应用 patch；它们明确展示要改的字段、控制流和调用点，但需要在真实 checkout 中按当前代码合并。
5. 也可以从 `repo-overlay/apps/kimi-shell/src/features/workspace-grid/` 复制前端文件，再参照 `0003-*.integration.diff` 接入 store/titlebar/controller。
6. 执行现有仓库测试：

   ```bash
   pnpm -C apps/kimi-shell test
   pnpm -C apps/kimi-shell build
   cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml
   cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml
   ```

7. 在 Windows 真机执行 `docs/TEST_MATRIX.md`。

## 本包已验证内容

在本地独立环境中已执行：

```bash
scripts/run_frontend_reference_tests.sh
```

结果：

- `tsc` strict 编译通过；
- Node 测试 9/9 通过；
- 结果保存在 `test-output/`。

## 未验证内容

- 没有完整仓库文件系统，因此没有运行 kimi-app 全量 pnpm/Vitest 构建。
- 当前环境没有 Rust toolchain，因此 Rust 集成示例及相关 integration diff 未运行 `cargo check`。
- 当前环境不是 Windows，因此没有实际写注册表、调用 Shell notify 或验证 Windows 10/11 菜单合并行为。

这些限制不影响代码审查结论，但意味着补丁必须在仓库 checkout 和 Windows CI/真机上完成最后验证。
