# 第三方开源与品牌说明

## MoonshotAI/kimi-cli Web

- 上游仓库：https://github.com/MoonshotAI/kimi-cli
- 上游路径：`web/`
- 当前记录 commit：`e32568cf2db0e95ad76878a4e6482986c8ecb180`
- 许可证：Apache-2.0
- 本地记录：`third_party/kimi-cli-web/`

本应用保留 MoonshotAI/kimi-cli Web 的上游源码审查快照，并在官方 Kimi runtime 页面外提供本地桌面壳集成；这些本地集成由本应用维护，不代表 MoonshotAI 官方背书，也不授予 MoonshotAI 或 Kimi 相关商标权。

## 本地修改摘要

- 历史版本曾提供官方 Web / 本地增强版切换、静态 wrapper 与 workspace proxy 注入；这些路径已退出当前产品主链。
- 当前生产直接加载官方 Kimi runtime URL，桌面主题、session、外链和有界响应式适配由 all-frame bridge 承担。
- 同步下来的 `upstream-web/` 仅作为源码级 i18n / patch 审查基线，不作为运行时页面或 DOM 事实权威。
- 不修改官方认证、服务端 API、模型、计费、权限或安全语义。
