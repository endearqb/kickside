# Kimi Shell 版本更新说明

版本：`0.0.4`  
发布日期：`2026-03-05`

## 本次更新重点

本版本为 `0.0.3` 的回归修复补丁，解决“安装后目录右键可触发，但文件右键不触发链路”的问题。

## 变更详情

1. 文件右键命令模板兼容性修复
- 将文件右键注册命令调整为更稳健的形式：
  - `--open-files "%1"`
- 保留应用内解析对 `--open-files -- <path...>` 的兼容，不影响手动调用与已有脚本。

2. 文件对象注册兜底增强
- 在原有 `HKCU\\Software\\Classes\\*\\shell\\KimiWebShell` 之外，新增同步写入：
  - `HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\KimiWebShell`
- 目标是覆盖不同 Explorer 路径下的文件右键触发差异。

3. 右键状态校验同步升级
- 右键菜单状态检查新增 `AllFilesystemObjects` 键位与命令值一致性校验。
- 发现漂移时继续提示“启用右键菜单”可一键修复。

4. `open_request` 容错增强
- 对 `--open-files` 场景新增兼容：即使不带 literal `--`，文件名以 `--` 开头且路径存在时也会被识别为有效文件路径。

## 验证结果

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（24/24）。
- 关键模块测试通过：
  - `context_menu`：命令构造与匹配
  - `open_request`：参数解析与容错

## 升级建议

1. 安装 `0.0.4` 后，在控制中心执行一次“启用右键菜单”（确保注册表命令重写到最新模板）。
2. 先测目录右键，再测文件右键；若仍异常，请提供 `app.log` 中 `open-request parse` 相关日志行。
