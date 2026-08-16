---
version: alpha
name: KickSide Control Center Image Style
description: "A quiet two-pane desktop control center for KickSide, based on the provided Settings/Skills reference image: a merged navigation/object rail, dense object lists, clear detail pages, compact metadata, and carded markdown/code content."
colors:
  background: "#f4f4f2"
  background-subtle: "#f8f8f6"
  surface: "#ffffff"
  surface-muted: "#efefed"
  surface-hover: "#e9e9e6"
  rail: "#f2f2f0"
  rail-selected: "#e7e7e4"
  border: "#dededb"
  border-strong: "#c9c9c5"
  foreground: "#1f1f1f"
  foreground-muted: "#6f6f6a"
  foreground-soft: "#92928d"
  primary: "#1f1f1f"
  primary-foreground: "#ffffff"
  accent: "#34c284"
  accent-foreground: "#ffffff"
  info: "#4b76c8"
  warning: "#b7791f"
  destructive: "#d2483d"
  code-background: "#fbfbfa"
  code-border: "#e7e7e4"
typography:
  title-lg:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 20px
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  title-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: 650
    lineHeight: 1.25
  body-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  label-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
  meta-xs:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1
  code-sm:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.65
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  nav-width: 384px
  object-rail-width: 280px
  detail-max-width: 1120px
components:
  app-shell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
  primary-nav:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.foreground-muted}"
    width: "{spacing.nav-width}"
  object-rail:
    backgroundColor: "{colors.background-subtle}"
    textColor: "{colors.foreground}"
    width: "{spacing.object-rail-width}"
  nav-item-selected:
    backgroundColor: "{colors.rail-selected}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  list-item:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  list-item-selected:
    backgroundColor: "{colors.rail-selected}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  detail-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "32px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  switch-on:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
  tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground-muted}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  code-block:
    backgroundColor: "{colors.code-background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# KickSide Control Center Image Style

## Overview

KickSide 的控制中心采用“桌面设置面板 + Skill 文件浏览器”的视觉模型。界面不是展示页，也不是营销页，而是一个长期打开的本地工作台：左侧是合并后的导航与对象列表，右侧是当前对象的详情、配置和可执行操作。

参考图的原型核心是密集信息架构：一级导航、对象列表、详情页。KickSide 的当前控制中心不保留最左侧独立 sidebar，而是把一级视图与对象列表合并成一个左侧 rail：

```txt
Unified Rail                         Detail Panel
一级视图 + 折叠子菜单 / 对象列表        当前 step / connector / skill / workspace / schedule 的详情
```

界面气质是安静、精确、可扫描。不要使用玻璃态、重阴影、夸张渐变、大标题 hero、营销文案和装饰性图形。控制中心的好坏取决于用户能否快速判断：当前在哪个模块、选中了什么对象、对象是什么状态、下一步能执行什么。

推荐一级导航：

1. Workbench / 工作台
2. WorkspaceHub
3. Skills
4. Schedule / 调度
5. Diagnostics / 诊断

在视觉上，`Skills` 视图最贴近参考图：左侧合并栏展示 skill 分组和文件树，右侧展示 `SKILL.md` 元数据、描述、标签和代码/Markdown 预览。`WorkspaceHub` 和 `Schedule` 也沿用同一骨架，只替换对象类型。

## 层级与容器规则

### 三级结构模型

界面只有三个结构层级，禁止发明第四层：

- **L0 页面/弹窗**：唯一允许有整体边界（边框 + 阴影）的容器。
- **L1 分区（Section）**：用「分区标题 + 留白」划分，默认无边框、无背景。一个分区 = 一个用户任务（查看状态 / 执行操作 / 填写配置）。
- **L2 条目（Item）**：列表行、表单行、键值行。默认用分隔线或 hover 背景区分，不用卡片。

### 边框预算

- 从 L0 根节点到任意叶子元素，路径上「边框 + 背景」的分组容器最多 2 层（L0 本身算第 1 层）。
- Card 内的功能容器（code-card、table、row、metric）不计入分组预算；它们是内容排版，不是新的层级分组。
- **卡片资格**：只有可独立交互的对象（点击进详情、可选中、可拖拽的实体，如一个技能、一个机器人、一个模板）才允许渲染为卡片。纯展示的分组一律用 L1 分区。
- **键值对**一律用 definition list（灰色小标签 + 正常字重的值，行排列），禁止一值一卡。
- 分组靠字号、字重、留白表达，禁止靠“再包一层框”表达。

### 视觉 Token

- 圆角只有五档：`16px` 内容卡、`12px` 代码卡 / 表格 / row、`8px` 列表项 / 按钮 / pill、`6px` tag / 小图标按钮、`4px` 行内 code。
- 背景只有三档：`--bg-page` / `--bg-surface` / `--bg-inset`。inset 仅用于代码、路径、只读值的内嵌展示，且不加边框。
- 阴影只给浮层（弹窗、菜单、tooltip）。静态卡片零阴影。

### 状态词表

状态徽章只允许以下 6 个值，颜色与语义绑定，禁止新增同义词：

| 值 | 颜色 | 替代掉的旧词 |
|---|---|---|
| 运行中 | 绿 | running、稳定、就绪、已同步 |
| 已停止 | 灰 | 待机、未启用 |
| 待配置 | 黄 | 待办、待配置凭据、未配置、待检查、unknown |
| 错误 | 红 | error |
| 可选 | 灰（空心） | — |
| 已信任 | 绿（空心） | — |

技术值（PID、端口、URL、路径、版本号）保留英文/原文；所有标签、分组标题、状态文案一律中文。`RUNTIME` → `运行时`，`RISKS` → `风险`，`HARNESS TEMPLATES` → `Harness 模板`（专有名词保留）。

### 界面文案规则

- 页头副标题删除。导航项名称已说明用途。
- 侧边栏项使用图标 + 名称，不带副标题。
- 任何一段说明文字必须能回答“用户读完会做出什么不同的操作”，答不上来就删。
- 按钮 = 动词 + 宾语（“创建工作区”，不是“确定”），且全流程同名（按钮“创建工作区” → toast“已创建工作区”）。
- 空状态 = 一句话 + 一个动作按钮。同屏最多一个空状态。
- 同一信息（标题、状态句）在一屏内只出现一次。

### 说明文字处理

现有说明文字按顺序处理：

1. 复述控件/标题已表达的内容：删除。
2. 影响当前操作决策（必填、危险后果、格式要求、前置条件）：内联保留，压缩到 1 行且不超过 20 字。
3. 补充性背景（字段含义、路径用途、来源说明、首次使用才需要）：收进 16px 的 `ⓘ` tooltip。
4. 空状态引导、错误信息、危险操作警告：必须内联，禁止进 tooltip。

Tooltip 触发器统一跟在标签后，不单独占行；内容不超过 2 行纯文本，不放链接和按钮；必须支持键盘 focus 触发，移动端降级为点按弹出；一个分区内 tooltip 不超过 3 个。

## Colors

色彩系统以中性灰白为主体，绿色只表达“启用 / 正常 / 可运行”。不要沿用“每张卡都有品牌色点缀”的控制台模板。

- **Background `#f4f4f2`**：页面底色，接近桌面设置面板的灰白，不使用纯白铺满整个窗口。
- **Rail `#f2f2f0` / Background subtle `#f8f8f6`**：左侧一级导航与中间对象列表的底色，靠 `1px` 边框区分层级。
- **Surface `#ffffff`**：详情主卡片与输入区。白色只用于承载内容，不用于整屏背景。
- **Foreground `#1f1f1f`**：标题、正文与主按钮。
- **Muted foreground `#6f6f6a`**：元信息、说明、路径、列表二级文本。
- **Accent `#34c284`**：仅用于开启状态、正常状态、小型状态点和 Switch。不要用于大面积背景、标题或装饰线。
- **Destructive `#d2483d`**：只用于删除、失败和不可恢复动作。

状态表达尽量用“圆点 + 文本”或 Switch，而不是彩色药丸。标签使用浅灰底，不抢内容。

## Typography

字体采用系统 UI 栈，保证桌面端原生感。不要使用品牌化大标题或网页 hero 字号。

- **Title lg, 20px / 650**：详情页主标题，例如当前 skill、workspace 或调度任务名。
- **Title md, 18px / 650**：主内容卡片标题，例如 `Notion`、`Quick Reference`、`工作区心跳`。
- **Body md, 14px / 400**：主要说明文字。
- **Body sm, 13px / 400**：列表行、按钮、字段值。
- **Label sm, 12px / 500**：表单标签与分组标题。
- **Meta xs, 11px / 600**：大写分区标题、状态说明、时间戳。
- **Code sm, 12px / monospace**：代码块、路径、命令、计划片段。

正文行高保持 1.4–1.65。列表文本不得使用过多字重；选中态靠背景色和上下文，不靠加粗到 700。

## Layout

默认布局是两栏：

```txt
┌────────────────────────────────────┬────────────────────────────────────┐
│ Unified Rail                        │ Detail Panel                        │
│ 384px                               │ fluid, max content 1120px           │
└────────────────────────────────────┴────────────────────────────────────┘
```

- **Unified Rail**：合并一级导航和对象列表。一级视图始终可见；快速设置步骤、运行诊断、外部 IM Connector、Skill 来源、WorkspaceHub 对象和调度工作区作为二级分组默认折叠。宽度约 384px，背景为 `background-subtle`。
- **Detail Panel**：当前对象的详情和配置。滚动只发生在该列内部；详情内容最大宽度约 1120px，左对齐。

Unified Rail 头部只保留“控制中心”和文字按钮“退出”；保存、Doctor、刷新等操作必须放在右侧详情页内。Detail Panel 不再有额外的全局 header 或 icon close button。

窄屏下布局变成：Unified Rail 与 Detail Panel 上下堆叠。不要把左栏收窄为仅图标 sidebar，也不要在窄屏保留多列挤压。

内容区布局应像参考图一样“元信息在上、正文卡片在下”：

1. 顶部详情标题行：标题、状态开关、更多操作。
2. 元信息网格：created by、last updated、runtime、workspace path 等。
3. 描述与标签。
4. 主内容卡片：配置、代码、任务计划、运行记录或 markdown 预览。

## Elevation & Depth

层级靠底色、边框和留白，不靠阴影。

- Unified Rail 与详情区之间用 `1px border`。
- 详情主卡片用 `1px border + 16px radius`，不加普通阴影。
- 浮层（Dialog、Popover、Dropdown）可以使用非常轻的 shadow，但普通 Card、ListItem、StatCard 不允许有阴影。
- 背景可以保留极轻的径向雾化光斑，透明度低于 0.45，只作为窗口质感，不作为内容装饰。
- Hover 只改变背景色，不做 `translateY`、放大、漂浮。

## Shapes

圆角克制，主要来自桌面设置面板的自然曲率。

- 列表项：`8px`。
- 按钮、输入框、标签：`6–8px`。
- 详情主卡片、代码块：`12–16px`。
- Switch 可用 full radius，因为它是原生开关形态。
- 不要把所有 badge 都做成胶囊；普通标签用小圆角矩形。

## Components

### App Shell

应用壳是全高两栏容器。`UnifiedRail` 固定，`DetailPanel` 独立滚动。禁止让整个 window 同时滚动，以免切换视图时上下文丢失。

### Unified Rail

一级视图文案保持短词：`工作台`、`快速设置`、`运行诊断`、`外部 IM 通道`、`Skill 投影`、`WorkspaceHub`、`调度`。

一级项始终可见；二级分组默认折叠，用户展开后在本次控制中心打开期间保持。选中态使用浅灰背景 `rail-selected`，图标与文字不需要品牌色。只有在线状态、启用状态用绿色。

### Secondary Groups

对象列表现在承载在 Unified Rail 的二级分组中，支持分组标题、折叠、搜索与新建入口。每一行包含 icon、名称、可选状态点和二级信息。选中对象使用浅灰背景，不使用描边框或彩色左边线。

### Detail Page Header

每个内容页自己渲染 `detail-top + meta-grid + description/tags + card/row/table/code`，不要在 Detail Panel 外再包一层全局 head。右上角最多一个 Switch、一个主按钮和一个更多菜单。不要在标题区堆多个按钮。

### Cards

详情主卡片用于展示一个主要实体的说明、代码、运行计划或配置。Card 背景白色、边框浅灰、圆角 16px。Card 内部标题 18px，正文 14px。

### Metrics

Metric 只能放在 Card 内部，每行最多 3 个。每个 Metric 必须同时有值和 hint 行；顶部对象属性一律使用 MetaGrid，不用 Metric。

### Code Block

代码块使用白色或近白背景，边框清晰，圆角 12px。行号使用 muted 文本。工具按钮（复制、下载）放在右上角，图标 16px，不显示大按钮。

### Buttons

主按钮使用深色背景，只在真正会写入、创建或启动的动作上使用。次级按钮使用浅灰背景或 ghost。危险按钮只用红色文字与浅红 hover，不大面积铺红。

### Switches

Switch 表示启用状态。开启为绿色，关闭为灰色。切换必须立刻反馈，但长耗时动作需要显示 pending 状态或 toast。

### WorkspaceHub

WorkspaceHub 使用同样的两栏结构：Unified Rail 中的对象列表是 harness 模板和已注册工作区，详情页展示模板用途、变量、将生成的文件树和创建按钮。openclaw 与 Hermes 模板不应做成营销卡片，而应做成可审阅的工作区骨架。

### Skills

Skills 视图最接近参考图：左侧对象列表列出内置技能、工作区技能、用户技能；右侧详情展示 `SKILL.md` 的 frontmatter、描述、标签、快速参考和文件预览。

### Schedule

调度视图以 workspace 为对象列表。详情页分为“工作区心跳”“定时任务”“运行记录”三个主卡片。状态用绿色 / 灰色 / 红色圆点，运行结果以 plan + outcome 卡片呈现。

## Do's and Don'ts

**Do**

- 使用两栏布局保留上下文。
- 使用灰白层级、细边框、紧凑列表。
- 把绿色限制为启用、正常、运行中状态。
- 让每个详情页只有一个主操作。
- 用 `SKILL.md`、`AGENTS.md`、路径、计划、运行记录作为真实内容。
- 为加载、空、错误、禁用、键盘焦点、窄屏分别设计状态。

**Don't**

- 不用玻璃态、重阴影、大面积渐变和漂浮卡片。
- 不写“赋能、打造、闭环、智能化中枢”这类营销词。
- 不把每个标签都做成彩色 pill。
- 不在标题区堆三四个按钮。
- 不让整个页面滚动；滚动应发生在对象列表或详情面板内部。
- 不在 hover 时位移或缩放列表项。
