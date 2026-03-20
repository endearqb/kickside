# Kimi Desktop Shell Release Notes

Version: `v0.0.29`  
Release date: `2026-03-20`

## What's New

- 增强 IM Bridge 诊断能力，可更清楚看到 Feishu 通道异常、自动恢复状态和最近错误信息。
- 优化控制中心 Bridge Runtime 面板，状态展示更清晰，排障更直接。
- `bridge-ops` 升级为真正的 CLI Agent Skill，后续可通过 skill 方式执行重启 bridge、查看状态、切换 session 等操作。
- Feishu bridge 运维不再依赖旧的隐藏原生执行链，后续接入 Skill Center 会更自然。
- 继续完善 Feishu 图片、文件和交互式回复链路，整体稳定性更好。

## Notes

- `bridge-ops` skill 默认不会自动加载。
- 如需启用，请显式设置 `KIMI_BRIDGE_SKILLS_DIR` 指向项目 `skills` 目录。
