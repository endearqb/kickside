export type AgentTip = {
  id: string;
  numberLabel: string;
  title: string;
  body: string;
};

export const agentTips: AgentTip[] = [
  {
    id: "tip-01",
    numberLabel: "TIP 01",
    title: "第一步：创建 AGENTS.MD",
    body: "在开始任何任务之前，先花时间创建项目根目录的 AGENTS.MD。这是 Agent 的“宪法”——它定义了权限边界、可用工具、工作目录和命名约定。理解这份文档，能让你的每一次指令都更精准，也能避免 Agent 走入死胡同或做出越权操作。把它当作入职第一天的必读手册。",
  },
  {
    id: "tip-02",
    numberLabel: "TIP 02",
    title: "按任务类型选择合适的 Skill",
    body: "不同任务对应不同 Skill 文件。写报告用 docx skill，做演示用 pptx skill，做数据表用 xlsx skill。激活正确的 Skill，Agent 会自动套用最佳实践模板，省去大量重复调试的时间。",
  },
  {
    id: "tip-03",
    numberLabel: "TIP 03",
    title: "配置好工作目录与权限范围",
    body: "明确告知 Agent 哪些目录可以读写、哪些是只读区域。合理的权限边界，既能保护你的重要文件，也能让 Agent 放手去做该做的事，减少反复确认的摩擦。",
  },
  {
    id: "tip-04",
    numberLabel: "TIP 04",
    title: "保持工具链的简洁与稳定",
    body: "不要同时开启过多 MCP 工具。每增加一个工具，Agent 的决策路径就更复杂。按需启用，用完即关，保持工具集的精简，能显著提升 Agent 的执行准确率。",
  },
  {
    id: "tip-05",
    numberLabel: "TIP 05",
    title: "为长期项目建立专属上下文文件",
    body: "创建一个项目专属的 context.md，记录项目背景、关键决策、术语约定。每次开启新会话时，先将这份文件喂给 Agent，让它快速进入状态，无需重复铺垫。",
  },
  {
    id: "tip-06",
    numberLabel: "TIP 06",
    title: "指令要“目标导向”而非“步骤导向”",
    body: "告诉 Agent 你想要什么结果，而不是每一步怎么做。过度指定步骤会限制 Agent 的自主判断，反而降低质量。描述终态，让 Agent 自己规划路径。",
  },
  {
    id: "tip-07",
    numberLabel: "TIP 07",
    title: "用正向示例 + 反向示例双重约束",
    body: "在关键任务中同时提供“我想要这样”和“我不想要那样”的例子。双向约束能大幅缩小 Agent 的输出空间，减少来回修改的次数，尤其适合有强烈风格偏好的创作类任务。",
  },
  {
    id: "tip-08",
    numberLabel: "TIP 08",
    title: "善用 XML 标签结构化你的指令",
    body: "复杂任务可以用 <context><task><format><constraints> 等标签分区描述。结构化指令让 Agent 能清晰区分背景、目标和约束，避免关键信息被淹没在大段文字中。",
  },
  {
    id: "tip-09",
    numberLabel: "TIP 09",
    title: "耐心是最被低估的技能",
    body: "Agent 第一次没做好，先不要沮丧。分析它在哪一步偏离了目标，针对性地补充信息或重新表述，而不是全部推倒重来。每次修正都是对提示语工程的一次学习。",
  },
  {
    id: "tip-10",
    numberLabel: "TIP 10",
    title: "让 Agent 先思考再行动",
    body: "在复杂任务前加上指令：“先列出你的执行计划，确认后再开始”。这一步能暴露 Agent 对任务的理解偏差，在执行前就纠正方向，避免跑偏后大量返工。",
  },
  {
    id: "tip-11",
    numberLabel: "TIP 11",
    title: "指定输出格式与长度",
    body: "明确告知期望的输出格式：“用 Markdown 表格”、“控制在 500 字以内”、“分三个层级列出”。格式约束不仅让输出更易用，也能倒逼 Agent 更精炼地组织内容。",
  },
  {
    id: "tip-12",
    numberLabel: "TIP 12",
    title: "把工作流当产品来迭代",
    body: "你与 Agent 协作的方式本身就是一个需要持续优化的“产品”。记录每次任务的成功与失败，定期复盘哪些提示语有效、哪些工具组合顺畅、哪些环节反复出问题。像做产品迭代一样，每周改进一个环节，积累复利效应。",
  },
  {
    id: "tip-13",
    numberLabel: "TIP 13",
    title: "拆分大任务，分步执行",
    body: "把复杂项目拆成独立的子任务，每个子任务有明确的输入和输出。分步执行比一次性下达大指令更稳定，也更容易在中途发现并纠正偏差。",
  },
  {
    id: "tip-14",
    numberLabel: "TIP 14",
    title: "建立检查点，不要一次性放手",
    body: "对于长流程任务，在关键节点设置人工检查点。Agent 完成阶段性成果后暂停，由你审核确认再继续。这样既保留了 Agent 的自主性，也保持了对结果质量的掌控。",
  },
  {
    id: "tip-15",
    numberLabel: "TIP 15",
    title: "把成功的提示语版本化管理",
    body: "有效的提示语是宝贵资产。用 Git 或笔记工具对提示语进行版本管理，记录每次修改的原因和效果。这是提示语工程走向专业化的关键一步。",
  },
  {
    id: "tip-16",
    numberLabel: "TIP 16",
    title: "用模板标准化高频任务",
    body: "对于周报、代码审查、需求文档等重复性任务，提炼出标准化的提示语模板，每次只需填入变量即可。标准化能让 Agent 的输出更稳定，也让团队协作更一致。",
  },
  {
    id: "tip-17",
    numberLabel: "TIP 17",
    title: "组合多个 Agent 处理复杂流程",
    body: "不同 Agent 各有所长。研究类、写作类、代码类任务可以串联多个 Agent，让上一个的输出成为下一个的输入，构建真正的自动化流水线。",
  },
  {
    id: "tip-18",
    numberLabel: "TIP 18",
    title: "沉淀可复用的 SOP 文档",
    body: "每当你和 Agent 摸索出一套有效的工作方法，立即将其固化为 SOP。包括：任务描述模板、工具配置、典型示例、常见坑点。SOP 是你与 AI 协作能力的护城河。",
  },
  {
    id: "tip-19",
    numberLabel: "TIP 19",
    title: "建立错误案例库",
    body: "记录 Agent 犯过的典型错误和你的修复策略。错误案例库是比成功案例更有价值的学习材料，能帮你在类似情况出现时快速定位问题根源。",
  },
  {
    id: "tip-20",
    numberLabel: "TIP 20",
    title: "定期提炼“最佳提示语清单”",
    body: "每月从历史对话中挑选出效果最好的 10 条提示语，整理成清单。这份清单就是你专属的提示语资产库，随时可以复用和分享给团队。",
  },
  {
    id: "tip-21",
    numberLabel: "TIP 21",
    title: "让 Agent 帮你写 Agent 的使用手册",
    body: "让 Agent 回顾一段时间内的协作记录，自动生成使用总结和改进建议。AI 帮你优化与 AI 的协作方式，这本身就是一种元级别的效率提升。",
  },
  {
    id: "tip-22",
    numberLabel: "TIP 22",
    title: "把 Agent 当聪明的新人，而非全知的神",
    body: "Agent 很聪明，但它需要清晰的上下文和明确的期望才能发挥最大价值。就像带一个高潜力的新员工，你需要提供背景、给出标准、及时反馈，而不是扔给它一个任务就期待完美交付。",
  },
  {
    id: "tip-23",
    numberLabel: "TIP 23",
    title: "保持批判性审视，不要全盘接受",
    body: "Agent 的输出始终需要你的判断和审核。尤其是涉及事实、数据、法律、财务的内容，必须交叉验证。信任 Agent 的效率，但保留自己的判断力。",
  },
  {
    id: "tip-24",
    numberLabel: "TIP 24",
    title: "投资学习提示语工程，回报持续复利",
    body: "提示语工程是 AI 时代最值得投资的技能之一。每花一小时学习提示语设计原理，都会让你此后每一次与 Agent 的协作更高效。这是一项收益随时间指数增长的能力。",
  },
  {
    id: "tip-25",
    numberLabel: "TIP 25",
    title: "用 Agent 放大你的优势，而非弥补短板",
    body: "最聪明的 Agent 用法，是把它用在你已经擅长的领域，让它帮你把好的想法变得更快、更大、更精。AI 是杠杆，支点越强，撬动的空间就越大。",
  },
];

export function pickRandomAgentTip(): AgentTip {
  return agentTips[Math.floor(Math.random() * agentTips.length)] ?? agentTips[0];
}
