# Kimi 小助手 v0.1.7 发布说明

发布日期：`2026-07-11`

## 更新内容

- WorkspaceHub 的已注册工作区详情改为聚焦文件浏览：顶部保留返回、工作区名称、状态、运行时、来源，以及“编辑调度”和“打开工作区”操作。
- 详情主体移除路径摘要、标签、Skill 清单和调度摘要，文件树与文件预览现在占满主要空间。
- Harness 模板详情与创建流程保持不变。

## 安装包

- NSIS：`kimi sidekick_0.1.7_x64-setup.exe`
- MSI：`kimi sidekick_0.1.7_x64_en-US.msi`

## 验证

- TypeScript 类型检查通过。
- Vitest 测试通过（15 个文件、99 项测试）。
- 已执行 `git diff --check`。

## 已知事项

- 建议在实际桌面窗口中确认窄屏时 WorkspaceHub 详情顶部操作区的换行显示。
