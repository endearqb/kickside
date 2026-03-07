```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>桌面级 AI Agent 使用指南</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=Noto+Sans+SC:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #1a1208;
    --paper: #f5f0e8;
    --cream: #ede8dc;
    --gold: #c8953a;
    --gold-light: #e8b96a;
    --rust: #9b4a2b;
    --sage: #4a6741;
    --muted: #7a7060;
    --accent: #2d4a6b;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background-color: var(--paper);
    color: var(--ink);
    font-family: 'Noto Sans SC', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* Grain texture overlay */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 1000;
    opacity: 0.4;
  }

  header {
    padding: 80px 40px 60px;
    text-align: center;
    border-bottom: 1px solid rgba(200,149,58,0.3);
    position: relative;
  }

  header::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 50%;
    transform: translateX(-50%);
    width: 120px;
    height: 3px;
    background: var(--gold);
  }

  .header-label {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.3em;
    color: var(--gold);
    text-transform: uppercase;
    margin-bottom: 24px;
  }

  h1 {
    font-family: 'Noto Serif SC', serif;
    font-size: clamp(2.2rem, 5vw, 3.8rem);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin-bottom: 20px;
  }

  h1 em {
    font-style: normal;
    color: var(--gold);
  }

  .subtitle {
    font-size: 1rem;
    color: var(--muted);
    font-weight: 300;
    letter-spacing: 0.05em;
    max-width: 500px;
    margin: 0 auto;
    line-height: 1.8;
  }

  .deco-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 28px 0 0;
    color: var(--gold);
    font-size: 18px;
  }

  .deco-line span {
    width: 60px;
    height: 1px;
    background: var(--gold);
    opacity: 0.5;
  }

  /* Category sections */
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 60px 40px 100px;
  }

  .category {
    margin-bottom: 64px;
  }

  .category-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
  }

  .category-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .cat-a .category-icon { background: rgba(200,149,58,0.15); }
  .cat-b .category-icon { background: rgba(45,74,107,0.12); }
  .cat-c .category-icon { background: rgba(74,103,65,0.12); }
  .cat-d .category-icon { background: rgba(155,74,43,0.12); }
  .cat-e .category-icon { background: rgba(122,112,96,0.12); }

  .category-title {
    font-family: 'Noto Serif SC', serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.05em;
  }

  .category-num {
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.2em;
    margin-top: 2px;
  }

  /* Tips grid */
  .tips-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }

  .tip-card {
    background: var(--cream);
    border: 1px solid rgba(200,149,58,0.2);
    border-radius: 4px;
    padding: 24px 26px;
    position: relative;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: default;
  }

  .tip-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(26,18,8,0.08);
    border-color: var(--gold);
  }

  .tip-number {
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    color: var(--gold);
    margin-bottom: 12px;
    display: block;
  }

  .tip-title {
    font-family: 'Noto Serif SC', serif;
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 10px;
    line-height: 1.5;
  }

  .tip-body {
    font-size: 0.875rem;
    color: var(--muted);
    line-height: 1.8;
    font-weight: 300;
  }

  .tip-body strong {
    color: var(--rust);
    font-weight: 500;
  }

  /* Corner accent */
  .tip-card::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 0 20px 20px 0;
    border-color: transparent rgba(200,149,58,0.15) transparent transparent;
    border-radius: 0 4px 0 0;
    transition: border-color 0.2s ease;
  }

  .tip-card:hover::after {
    border-color: transparent var(--gold) transparent transparent;
  }

  /* Featured tip - wider */
  .tip-card.featured {
    grid-column: span 2;
    background: var(--ink);
    color: var(--paper);
    border-color: var(--gold);
  }

  .tip-card.featured .tip-number { color: var(--gold-light); }
  .tip-card.featured .tip-title { color: var(--paper); }
  .tip-card.featured .tip-body { color: rgba(245,240,232,0.65); }
  .tip-card.featured .tip-body strong { color: var(--gold-light); }
  .tip-card.featured::after { border-color: transparent var(--gold) transparent transparent; }

  /* Footer */
  footer {
    border-top: 1px solid rgba(200,149,58,0.2);
    padding: 40px;
    text-align: center;
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.25em;
    color: var(--muted);
  }

  /* Animations */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .tip-card {
    animation: fadeUp 0.5s ease both;
  }

  .category:nth-child(1) .tip-card:nth-child(1) { animation-delay: 0.05s; }
  .category:nth-child(1) .tip-card:nth-child(2) { animation-delay: 0.10s; }
  .category:nth-child(1) .tip-card:nth-child(3) { animation-delay: 0.15s; }
  .category:nth-child(1) .tip-card:nth-child(4) { animation-delay: 0.20s; }
  .category:nth-child(1) .tip-card:nth-child(5) { animation-delay: 0.25s; }

  @media (max-width: 680px) {
    .tips-grid { grid-template-columns: 1fr; }
    .tip-card.featured { grid-column: span 1; }
    header { padding: 50px 24px 40px; }
    .container { padding: 40px 24px 60px; }
  }
</style>
</head>
<body>

<header>
  <div class="header-label">Desktop AI Agent · 25 Tips</div>
  <h1>用好桌面级 <em>AI Agent</em><br>的二十五条心法</h1>
  <p class="subtitle">从工具配置到工作流打磨，从沟通技巧到知识沉淀<br>系统性地释放 AI Agent 的全部潜力</p>
  <div class="deco-line"><span></span>◆<span></span></div>
</header>

<div class="container">

  <!-- Category 1 -->
  <div class="category cat-a">
    <div class="category-header">
      <div class="category-icon">⚙️</div>
      <div>
        <div class="category-title">基础配置与环境搭建</div>
        <div class="category-num">TIPS 01 — 05</div>
      </div>
    </div>
    <div class="tips-grid">
      <div class="tip-card featured">
        <span class="tip-number">TIP 01</span>
        <div class="tip-title">第一步：创建 AGENTS.MD</div>
        <div class="tip-body">在开始任何任务之前，先花时间创建项目根目录的 <strong>AGENTS.MD</strong>。这是 Agent 的"宪法"——它定义了权限边界、可用工具、工作目录和命名约定。理解这份文档，能让你的每一次指令都更精准，也能避免 Agent 走入死胡同或做出越权操作。把它当作入职第一天的必读手册。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 02</span>
        <div class="tip-title">按任务类型选择合适的 Skill</div>
        <div class="tip-body">不同任务对应不同 Skill 文件。写报告用 <strong>docx skill</strong>，做演示用 <strong>pptx skill</strong>，做数据表用 <strong>xlsx skill</strong>。激活正确的 Skill，Agent 会自动套用最佳实践模板，省去大量重复调试的时间。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 03</span>
        <div class="tip-title">配置好工作目录与权限范围</div>
        <div class="tip-body">明确告知 Agent 哪些目录可以读写、哪些是只读区域。合理的权限边界，既能保护你的重要文件，也能让 Agent 放手去做该做的事，<strong>减少反复确认的摩擦</strong>。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 04</span>
        <div class="tip-title">保持工具链的简洁与稳定</div>
        <div class="tip-body">不要同时开启过多 MCP 工具。每增加一个工具，Agent 的决策路径就更复杂。<strong>按需启用</strong>，用完即关，保持工具集的精简，能显著提升 Agent 的执行准确率。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 05</span>
        <div class="tip-title">为长期项目建立专属上下文文件</div>
        <div class="tip-body">创建一个项目专属的 <strong>context.md</strong>，记录项目背景、关键决策、术语约定。每次开启新会话时，先将这份文件喂给 Agent，让它快速进入状态，无需重复铺垫。</div>
      </div>
    </div>
  </div>

  <!-- Category 2 -->
  <div class="category cat-b">
    <div class="category-header">
      <div class="category-icon">💬</div>
      <div>
        <div class="category-title">沟通技巧与指令设计</div>
        <div class="category-num">TIPS 06 — 11</div>
      </div>
    </div>
    <div class="tips-grid">
      <div class="tip-card">
        <span class="tip-number">TIP 06</span>
        <div class="tip-title">指令要"目标导向"而非"步骤导向"</div>
        <div class="tip-body">告诉 Agent <strong>你想要什么结果</strong>，而不是每一步怎么做。过度指定步骤会限制 Agent 的自主判断，反而降低质量。描述终态，让 Agent 自己规划路径。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 07</span>
        <div class="tip-title">用正向示例 + 反向示例双重约束</div>
        <div class="tip-body">在关键任务中同时提供<strong>"我想要这样"和"我不想要那样"</strong>的例子。双向约束能大幅缩小 Agent 的输出空间，减少来回修改的次数，尤其适合有强烈风格偏好的创作类任务。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 08</span>
        <div class="tip-title">善用 XML 标签结构化你的指令</div>
        <div class="tip-body">复杂任务可以用 <strong>&lt;context&gt;&lt;task&gt;&lt;format&gt;&lt;constraints&gt;</strong> 等标签分区描述。结构化指令让 Agent 能清晰区分背景、目标和约束，避免关键信息被淹没在大段文字中。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 09</span>
        <div class="tip-title">耐心是最被低估的技能</div>
        <div class="tip-body">Agent 第一次没做好，先不要沮丧。<strong>分析它在哪一步偏离了目标</strong>，针对性地补充信息或重新表述，而不是全部推倒重来。每次修正都是对提示语工程的一次学习。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 10</span>
        <div class="tip-title">让 Agent 先思考再行动</div>
        <div class="tip-body">在复杂任务前加上指令：<strong>"先列出你的执行计划，确认后再开始"</strong>。这一步能暴露 Agent 对任务的理解偏差，在执行前就纠正方向，避免跑偏后大量返工。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 11</span>
        <div class="tip-title">指定输出格式与长度</div>
        <div class="tip-body">明确告知期望的输出格式：<strong>"用 Markdown 表格"、"控制在 500 字以内"、"分三个层级列出"</strong>。格式约束不仅让输出更易用，也能倒逼 Agent 更精炼地组织内容。</div>
      </div>
    </div>
  </div>

  <!-- Category 3 -->
  <div class="category cat-c">
    <div class="category-header">
      <div class="category-icon">🔄</div>
      <div>
        <div class="category-title">工作流设计与持续迭代</div>
        <div class="category-num">TIPS 12 — 17</div>
      </div>
    </div>
    <div class="tips-grid">
      <div class="tip-card featured">
        <span class="tip-number">TIP 12</span>
        <div class="tip-title">把工作流当产品来迭代</div>
        <div class="tip-body">你与 Agent 协作的方式本身就是一个需要持续优化的"产品"。<strong>记录每次任务的成功与失败</strong>，定期复盘哪些提示语有效、哪些工具组合顺畅、哪些环节反复出问题。像做产品迭代一样，每周改进一个环节，积累复利效应。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 13</span>
        <div class="tip-title">拆分大任务，分步执行</div>
        <div class="tip-body">把复杂项目拆成<strong>独立的子任务</strong>，每个子任务有明确的输入和输出。分步执行比一次性下达大指令更稳定，也更容易在中途发现并纠正偏差。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 14</span>
        <div class="tip-title">建立检查点，不要一次性放手</div>
        <div class="tip-body">对于长流程任务，在关键节点设置<strong>人工检查点</strong>。Agent 完成阶段性成果后暂停，由你审核确认再继续。这样既保留了 Agent 的自主性，也保持了对结果质量的掌控。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 15</span>
        <div class="tip-title">把成功的提示语版本化管理</div>
        <div class="tip-body">有效的提示语是宝贵资产。用 <strong>Git 或笔记工具</strong>对提示语进行版本管理，记录每次修改的原因和效果。这是提示语工程走向专业化的关键一步。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 16</span>
        <div class="tip-title">用模板标准化高频任务</div>
        <div class="tip-body">对于周报、代码审查、需求文档等<strong>重复性任务</strong>，提炼出标准化的提示语模板，每次只需填入变量即可。标准化能让 Agent 的输出更稳定，也让团队协作更一致。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 17</span>
        <div class="tip-title">组合多个 Agent 处理复杂流程</div>
        <div class="tip-body">不同 Agent 各有所长。研究类、写作类、代码类任务可以<strong>串联多个 Agent</strong>，让上一个的输出成为下一个的输入，构建真正的自动化流水线。</div>
      </div>
    </div>
  </div>

  <!-- Category 4 -->
  <div class="category cat-d">
    <div class="category-header">
      <div class="category-icon">📚</div>
      <div>
        <div class="category-title">知识沉淀与 SOP 建设</div>
        <div class="category-num">TIPS 18 — 21</div>
      </div>
    </div>
    <div class="tips-grid">
      <div class="tip-card">
        <span class="tip-number">TIP 18</span>
        <div class="tip-title">沉淀可复用的 SOP 文档</div>
        <div class="tip-body">每当你和 Agent 摸索出一套有效的工作方法，立即将其<strong>固化为 SOP</strong>。包括：任务描述模板、工具配置、典型示例、常见坑点。SOP 是你与 AI 协作能力的护城河。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 19</span>
        <div class="tip-title">建立错误案例库</div>
        <div class="tip-body">记录 Agent 犯过的典型错误和你的<strong>修复策略</strong>。错误案例库是比成功案例更有价值的学习材料，能帮你在类似情况出现时快速定位问题根源。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 20</span>
        <div class="tip-title">定期提炼"最佳提示语清单"</div>
        <div class="tip-body">每月从历史对话中<strong>挑选出效果最好的 10 条提示语</strong>，整理成清单。这份清单就是你专属的提示语资产库，随时可以复用和分享给团队。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 21</span>
        <div class="tip-title">让 Agent 帮你写 Agent 的使用手册</div>
        <div class="tip-body">让 Agent 回顾一段时间内的协作记录，<strong>自动生成使用总结和改进建议</strong>。AI 帮你优化与 AI 的协作方式，这本身就是一种元级别的效率提升。</div>
      </div>
    </div>
  </div>

  <!-- Category 5 -->
  <div class="category cat-e">
    <div class="category-header">
      <div class="category-icon">🧠</div>
      <div>
        <div class="category-title">心态与高阶认知</div>
        <div class="category-num">TIPS 22 — 25</div>
      </div>
    </div>
    <div class="tips-grid">
      <div class="tip-card">
        <span class="tip-number">TIP 22</span>
        <div class="tip-title">把 Agent 当聪明的新人，而非全知的神</div>
        <div class="tip-body">Agent 很聪明，但它需要<strong>清晰的上下文和明确的期望</strong>才能发挥最大价值。就像带一个高潜力的新员工，你需要提供背景、给出标准、及时反馈，而不是扔给它一个任务就期待完美交付。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 23</span>
        <div class="tip-title">保持批判性审视，不要全盘接受</div>
        <div class="tip-body">Agent 的输出始终需要你的<strong>判断和审核</strong>。尤其是涉及事实、数据、法律、财务的内容，必须交叉验证。信任 Agent 的效率，但保留自己的判断力。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 24</span>
        <div class="tip-title">投资学习提示语工程，回报持续复利</div>
        <div class="tip-body">提示语工程是 AI 时代最值得投资的技能之一。每花一小时学习<strong>提示语设计原理</strong>，都会让你此后每一次与 Agent 的协作更高效。这是一项收益随时间指数增长的能力。</div>
      </div>
      <div class="tip-card">
        <span class="tip-number">TIP 25</span>
        <div class="tip-title">用 Agent 放大你的优势，而非弥补短板</div>
        <div class="tip-body">最聪明的 Agent 用法，是把它用在<strong>你已经擅长的领域</strong>——让它帮你把好的想法变得更快、更大、更精。AI 是杠杆，支点越强，撬动的空间就越大。</div>
      </div>
    </div>
  </div>

</div>

<footer>
  DESKTOP AI AGENT · 25 TIPS FOR MASTERY · 2026
</footer>

</body>
</html>
```