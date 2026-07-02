---
version: alpha
name: Kimi Control Center Image Style
description: "A quiet three-pane desktop control center for Kimi App, based on the provided Settings/Skills reference image: neutral rails, dense object lists, clear detail pages, compact metadata, and carded markdown/code content."
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
    letterSpacing: "-0.01em"
  title-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
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
  nav-width: 208px
  object-rail-width: 248px
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

# Kimi Control Center Image Style

## Overview

Kimi App 的控制中心采用“桌面设置面板 + Skill 文件浏览器”的视觉模型。界面不是展示页，也不是营销页，而是一个长期打开的本地工作台：左侧是稳定导航，中间是对象列表，右侧是当前对象的详情、配置和可执行操作。

参考图的核心是三栏密集信息架构：`Settings` 一级导航、`Skills` 对象列表、`Notion` 详情页。Kimi App 应保留这种明确的空间分工，并把原来的控制中心整理为：

```txt
Primary Nav        Object Rail             Detail Panel
设置 / 工作台       Skills / Workspaces      当前 skill / workspace / schedule 的详情
```

界面气质是安静、精确、可扫描。不要使用玻璃态、重阴影、夸张渐变、大标题 hero、营销文案和装饰性图形。控制中心的好坏取决于用户能否快速判断：当前在哪个模块、选中了什么对象、对象是什么状态、下一步能执行什么。

推荐一级导航：

1. Workbench / 工作台
2. WorkspaceHub
3. Skills
4. Schedule / 调度
5. Diagnostics / 诊断

在视觉上，`Skills` 视图最贴近参考图：中间栏展示 skill 分组和文件树，右侧展示 `SKILL.md` 元数据、描述、标签和代码/Markdown 预览。`WorkspaceHub` 和 `Schedule` 也沿用同一骨架，只替换对象类型。

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
- **Title md, 16px / 650**：主内容卡片标题，例如 `Notion`、`Quick Reference`、`工作区心跳`。
- **Body md, 14px / 400**：主要说明文字。
- **Body sm, 13px / 400**：列表行、按钮、字段值。
- **Label sm, 12px / 500**：表单标签与分组标题。
- **Meta xs, 11px / 600**：大写分区标题、状态说明、时间戳。
- **Code sm, 12px / monospace**：代码块、路径、命令、计划片段。

正文行高保持 1.4–1.65。列表文本不得使用过多字重；选中态靠背景色和上下文，不靠加粗到 700。

## Layout

默认布局是三栏：

```txt
┌────────────────┬────────────────────┬────────────────────────────────────┐
│ Primary Nav    │ Object Rail         │ Detail Panel                        │
│ 208px          │ 248px               │ fluid, max content 1120px           │
└────────────────┴────────────────────┴────────────────────────────────────┘
```

- **Primary Nav**：一级导航，包含工作台、WorkspaceHub、Skills、Schedule、Diagnostics。宽度固定，背景为 `rail`。
- **Object Rail**：当前一级视图下的对象列表。例如 Skills 视图列出 skill 分组；WorkspaceHub 视图列出 harness；Schedule 视图列出 workspace。宽度固定，背景为 `background-subtle`。
- **Detail Panel**：当前对象的详情和配置。滚动只发生在该列内部；详情内容最大宽度约 1120px，左对齐。

窄屏下布局变成：Primary Nav 收窄为 icon rail 或抽屉；Object Rail 与 Detail Panel 上下堆叠。不要在窄屏保留三列挤压。

内容区布局应像参考图一样“元信息在上、正文卡片在下”：

1. 顶部详情标题行：标题、状态开关、更多操作。
2. 元信息网格：created by、last updated、runtime、workspace path 等。
3. 描述与标签。
4. 主内容卡片：配置、代码、任务计划、运行记录或 markdown 预览。

## Elevation & Depth

层级靠底色、边框和留白，不靠阴影。

- 一级导航与对象列表之间用 `1px border`。
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

应用壳是全高三栏容器。`PrimaryNav` 与 `ObjectRail` 固定，`DetailPanel` 独立滚动。禁止让整个 window 同时滚动，以免切换视图时上下文丢失。

### Primary Navigation

一级导航文案保持短词：`Workbench`、`WorkspaceHub`、`Skills`、`Schedule`、`Diagnostics`。中文界面可用：`工作台`、`WorkspaceHub`、`Skills`、`调度`、`诊断`。

选中态使用浅灰背景 `rail-selected`，图标与文字不需要品牌色。只有在线状态、启用状态用绿色。

### Object Rail

对象列表支持分组标题、折叠、搜索与新建。每一行包含 icon、名称、可选状态点和二级信息。选中对象使用浅灰背景，不使用描边框或彩色左边线。

### Detail Header

详情页顶部必须包含标题、元信息、描述、标签和启用开关。右上角最多一个 Switch 和一个更多菜单。不要在标题区堆多个按钮。

### Cards

详情主卡片用于展示一个主要实体的说明、代码、运行计划或配置。Card 背景白色、边框浅灰、圆角 16px。Card 内部标题 16px，正文 14px。

### Code Block

代码块使用白色或近白背景，边框清晰，圆角 12px。行号使用 muted 文本。工具按钮（复制、下载）放在右上角，图标 16px，不显示大按钮。

### Buttons

主按钮使用深色背景，只在真正会写入、创建或启动的动作上使用。次级按钮使用浅灰背景或 ghost。危险按钮只用红色文字与浅红 hover，不大面积铺红。

### Switches

Switch 表示启用状态。开启为绿色，关闭为灰色。切换必须立刻反馈，但长耗时动作需要显示 pending 状态或 toast。

### WorkspaceHub

WorkspaceHub 使用同样的三栏结构：对象列表是 harness 模板，详情页展示模板用途、变量、将生成的文件树和创建按钮。openclaw 与 Hermes 模板不应做成营销卡片，而应做成可审阅的工作区骨架。

### Skills

Skills 视图最接近参考图：左侧对象列表列出内置技能、工作区技能、用户技能；右侧详情展示 `SKILL.md` 的 frontmatter、描述、标签、快速参考和文件预览。

### Schedule

调度视图以 workspace 为对象列表。详情页分为“工作区心跳”“定时任务”“运行记录”三个主卡片。状态用绿色 / 灰色 / 红色圆点，运行结果以 plan + outcome 卡片呈现。

## Do's and Don'ts

**Do**

- 使用三栏布局保留上下文。
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
