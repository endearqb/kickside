# 前端参考实现

这里的代码分为两类：

1. `workspacePaneShelfCore.ts`、`requestIdDeduper.ts`、`sessionPaneRouting.ts` 是无 React/Zustand 依赖的纯逻辑，可直接纳入 `features/workspace-grid`，并已在本包中通过 TypeScript 编译和 Node 测试。
2. `PaneShelf.tsx` 与 `PaneShelf.css` 是面向现有 `ShellTitlebar`/`gridTypes` 的 UI 参考实现，需要按补丁把 `showPane` 动作接入 Zustand store。

核心策略：六个可见槽位是渲染上限，不再等同于总 pane 上限；默认总上限为 12。第七个 Explorer pane 会显示在当前活跃槽位，被替换的 pane 进入 shelf，而不是让新请求悄悄隐藏。
