# Kimi Web 上游同步与维护约定

## 当前边界

- 当前运行时仍使用 workspace proxy 同源注入，不直接加载本地构建的上游 `web/` 前端。
- `third_party/kimi-cli-web/upstream-web/` 只作为上游源码快照基线，用于中文化盘点、源码级 patch 审查和后续迁移准备。
- 当前同步基线 commit：`e32568cf2db0e95ad76878a4e6482986c8ecb180`

## 同步方式

- 使用 `pnpm --dir apps/kimi-shell sync:kimi-web`。
- 默认行为是解析 `MoonshotAI/kimi-cli` 的 `main` HEAD，并把 `web/`、`LICENSE` 同步到本仓库。
- 同步完成后会更新：
  - `third_party/kimi-cli-web/upstream-web/`
  - `third_party/kimi-cli-web/SOURCE.md`
  - `public/enhanced-kimi-web/manifest.json`
  - `docs/third-party-notices.md`
  - 本文档里的同步基线 commit

## 本地改动边界

- 不直接修改 `third_party/kimi-cli-web/upstream-web/` 中的文件。
- 所有本地源码差异放在 `patches/kimi-web/` 或显式 overlay 文件中。
- 运行时注入脚本只承担桌面壳桥接、少量兜底中文化和小范围体验修正，不承担长期全量 i18n 维护。
- 当前第二阶段采用“全注入策略”覆盖固定 UI 文案，但边界只到文本节点、`placeholder`、`aria-label`、`title`、toast 标题和固定错误页框架，不处理动态 payload 文本。
- 当前第三阶段继续沿用全注入策略，新增覆盖聊天区工具标签、状态标签、输入区提示、会话右键菜单和上下文占用指示。
- 第三阶段允许的变量句式只有 `Thought for {n}s`、`{percent}% context`、`{n} selected` 三类；文件路径、URL、工具参数本体和后端 payload 文本仍不得通过注入拼接翻译。
- 当前品牌标题 `Kimi Code` 已纳入注入覆盖，但仅替换左上角可见标题为 `Kimi 小助手`；`/logo.png`、版本号、外链和 `alt`/`title`/`aria-label` 仍保持原样。
- 一旦注入开始依赖大量变量句子、复杂上下文判断或结构特判，应停止继续扩注入，改回源码 patch。

## 迁移建议

- 新增高频中文化时，先判断是否仍适合注入兜底；如果会频繁受上游 DOM 变更影响，应迁移到源码级 patch。
- 下一阶段从上游快照中识别可复用的消息层、常量层或组件边界，再引入最小 i18n 抽象，避免直接把英文原文继续当长期 key。
