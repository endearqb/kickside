# Kimi Web 上游同步与维护约定

## 当前边界

- 当前生产运行时直接加载 Kimi runtime URL，不恢复旧 workspace proxy；跨 iframe 主题、session、外链和响应式适配由 `src-tauri/src/frame_workspace_bridge.js` 的 all-frame initialization script 承担。
- `third_party/kimi-cli-web/upstream-web/` 只作为上游源码快照基线，用于中文化盘点、源码级 patch 审查和后续迁移准备。
- 当前同步基线 commit：`e32568cf2db0e95ad76878a4e6482986c8ecb180`
- 当前 Kimi Web DOM 与选择器事实以 `.ai/architecture/kimi-web-dom-contract.md` 的真实运行时审计为准；源码快照与运行时冲突时不得用快照覆盖实测事实。
- 当前 0.36.1 生产 bundle 的消息 TOC 是 `nav.conversation-toc`，左侧 `aside.side` 是独立的 Sessions sidebar。任何升级审计都必须分别验证二者，禁止再以 vendored 源码缺少 TOC 为由把 sidebar 当作 TOC。

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
- 运行时 all-frame 脚本只承担桌面壳桥接和有界体验修正；必须由宿主 `surface` 字段限定到 Kimi Code，并在 DOM 不匹配时 fail-open。
- 旧 workspace proxy 注入只作为历史兼容代码保留，不得在其上新增产品行为。
- 历史第二/第三阶段的“全注入”中文化规则仅描述旧 proxy 兼容实现，不是当前生产能力；固定文案、变量句式和品牌标题不得据此继续扩展。
- 一旦注入开始依赖大量变量句子、复杂上下文判断或结构特判，应停止继续扩注入，改回源码 patch。

## 迁移建议

- 新增高频中文化时优先评估源码级 patch；只有明确有界、fail-open 且不依赖复杂结构时，才允许复用 all-frame bridge 做壳集成兜底。
- 下一阶段从上游快照中识别可复用的消息层、常量层或组件边界，再引入最小 i18n 抽象，避免直接把英文原文继续当长期 key。
- 每次 Kimi Code 升级先执行 DOM contract 的升级检查；若上游已原生提供等价 Header、间距、颜色或抽屉行为，应删除对应兼容覆盖，不在注入层复制上游组件。
