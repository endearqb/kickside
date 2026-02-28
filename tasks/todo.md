# TODO - 按 docs/需求文档2.md 开发与执行

## 计划清单

- [x] 梳理并确认需求边界（OpenRequest、单实例转发、文件复制工作区、右键注册）
- [x] 设计并实现 `OpenRequest` 协议与命令行参数解析（`--open-dir` / `--open-files` / 宽松回退）
- [x] 实现“文件复制到默认工作目录新文件夹”的工作区创建逻辑（命名、去重、冲突处理）
- [x] 引入会话级工作目录覆盖（不污染默认工作目录配置），并接入后端重启流程
- [x] 接入 `tauri-plugin-single-instance`，将二次启动参数转发到主实例
- [x] 实现多文件请求聚合（350ms 防抖）以应对 Explorer 多次启动
- [x] 实现 Windows HKCU 右键菜单注册/卸载（目录空白处、文件夹、文件多选）
- [x] 暴露 Tauri 命令并在前端诊断页提供“启用/禁用/状态查看”入口
- [x] 运行格式化与测试（至少 `cargo fmt`、`cargo test`），修复阻塞问题
- [x] 更新文档回顾与结果记录

## 验收标准

- [x] `kimi-shell.exe --open-dir <path>` 能切换到目标目录并重启后端
- [x] `kimi-shell.exe --open-files <a> <b>` 能创建工作区并复制文件后切换
- [x] 多次快速 `--open-files` 请求仅创建一个工作区目录（聚合生效）
- [x] 注册右键后可从 Explorer 触发上述行为；禁用后注册表项清理完成
- [x] 原有功能（托盘、诊断、日志、重启）不回归

## 回顾（完成后填写）

- 实际变更：
  - 新增 `open_request` 模块，支持 `--open-dir` / `--open-files` 参数解析、文件工作区创建、复制与 `sources.json` 记录。
  - 新增会话级工作目录覆盖（`session_work_dir`），右键打开目录/文件仅影响当前会话，不覆盖默认配置。
  - 接入 `tauri-plugin-single-instance`，将二次启动参数转发给主实例；对 `OpenFiles` 做 350ms 防抖聚合。
  - 新增 `context_menu` 模块，支持 Windows HKCU 右键菜单启用/禁用与状态查询。
  - 前端诊断页新增 Explorer 右键菜单状态与启用/禁用操作。
  - 修复 `port_manager` 单测中的环境变量并发竞争，避免偶发失败。
- 验证结果：
  - `cargo fmt` 通过。
  - `cargo test` 通过（10/10）。
  - `pnpm build` 通过。
- 风险与后续：
  - 右键功能已支持注册表开关，但未在本轮自动化脚本中覆盖真实 Explorer 触发链路，建议后续补一个手工验收脚本或集成测试说明。
