请务必使用中文回复我。
UI 设计/改造必须主动调用 ui-pro-max-skill。

## Matt Pocock Skills 约定

这些 skills 是 Matt Pocock 工程化 AI 开发的最佳实践，安装于 `~/.config/opencode/skills/`。

### 强制/高优先 Skill

- `ui-ux-pro-max`：UI 设计/改造时必须主动调用。

### 开发流程 Skills（按使用顺序）

- `grilling` / `grill-me`：**任务启动前必须走 grilling 流程确认开发边界**，覆盖规划、编码、修复、重构、审查、文档、测试、配置、UI 改造等所有任务类型。能通过阅读代码/文档回答的问题必须先自行查证。
- `grill-with-docs`：grilling 增强版，同时建立领域模型、更新 `CONTEXT.md` 和 ADR。
- `domain-modeling`：涉及领域术语、业务规则或架构决策变化时，更新 `CONTEXT.md` 或必要 ADR。
- `tdd`：新功能或 bug 修复时遵循红-绿-重构循环（先写失败测试→实现→重构）。
- `diagnosing-bugs`：调试/缺陷诊断遵循诊断循环（复现→缩小→假设→插桩→修复→回归测试）。
- `code-review`：PR/分支/工作区变更审查，沿 Standards 和 Spec 两个轴并行审查。`review` 旧版已废弃，请用 `code-review`。
- `implement`：基于 PRD 或 issue 列表实施开发任务。

### 架构与设计 Skills

- `codebase-design`：模块接口设计、seam 决策、深层模块优化。
- `improve-codebase-architecture`：代码库架构腐化时扫描深化机会，生成可视化 HTML 报告。

### 项目管理 Skills

- `to-issues`：将计划/spec/PRD 分解为独立可抓取的 issues。
- `to-prd`：将当前对话合成为 PRD 并发布到 issue tracker。
- `triage`：将 issues 和外部 PR 按 triage 角色流转。

### 效率 Skills

- `handoff`：交接当前会话上下文给另一个 agent。
- `teach`：多会话教学新技能或概念。
- `writing-great-skills`：Skill 编写与维护参考规范。

### 文档规则

- 必须核对仓库的 `CONTEXT.md`、`CONTEXT-MAP.md` 与 `docs/adr/`。
- 涉及新的领域术语/边界/业务规则/权衡决策时，按 `domain-modeling` 更新 `CONTEXT.md` 或 ADR。
- 极小任务或无文档更新时，先明确"无新增边界/无文档更新"再继续。
