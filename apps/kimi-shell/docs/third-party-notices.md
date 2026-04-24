# 第三方开源与品牌说明

## MoonshotAI/kimi-cli Web

- 上游仓库：https://github.com/MoonshotAI/kimi-cli
- 上游路径：`web/`
- 当前记录 commit：`e32568cf2db0e95ad76878a4e6482986c8ecb180`
- 许可证：Apache-2.0
- 本地记录：`third_party/kimi-cli-web/`

本应用提供的“本地增强版”基于 MoonshotAI/kimi-cli 开源 Web 的公开许可边界进行产品化集成，由本应用维护；不代表 MoonshotAI 官方背书，也不授予 MoonshotAI 或 Kimi 相关商标权。

## 本地修改摘要

- 新增官方 Web / 本地增强版切换。
- 新增本地增强版静态入口、中文体验说明、主题转发与 session/prefill 消息转发。
- 新增增强版健康状态、失败回退、来源 commit 与发布前合规检查。
- 当前阶段保留 workspace proxy 同源注入作为运行时方案；同步下来的 `upstream-web/` 仅作为后续源码级 i18n / patch 基线。
- 不修改官方认证、服务端 API、模型、计费、权限或安全语义。
