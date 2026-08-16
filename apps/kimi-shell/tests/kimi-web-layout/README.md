# Kimi Web Layout Visual Fixture

该夹具依据 Kimi Code `0.36.1` 生产 bundle 的真实 DOM 契约裁剪，分别保留原生 `aside.side` Sessions sidebar、`nav.conversation-toc` 与 mobile `.turn-anchor[data-turn-id]`，不含用户数据。它不替代真实 WKWebView/WebView2 验证，也不得被当作上游源码。

运行回归：

```bash
pnpm check:kimi-web:visual
```

确认视觉变化符合预期后更新基线：

```bash
node scripts/check_kimi_web_layout_visual.mjs --update
```

10 张基线固定覆盖 `480/800/959/960/1179/1180/1280/1440px`、明暗主题、`narrow/compact/wide` 边界、1179px sidebar 原状、全宽度左侧 TOC 短条、亮暗主题下键盘聚焦后向右展开的毛玻璃浮层，以及 480px mobile projection。Chrome 不在标准路径时通过 `CHROME_PATH` 指定。
