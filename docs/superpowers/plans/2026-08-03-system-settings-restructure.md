# 系统设置页整合重构计划（傻瓜化改造）

## 目标与原则

把系统设置从「5 工作域 + 19 叶子页 + 三级导航 + 90+ 项」重构为「6 顶级导航 + 12 页 + 高级参数折叠 + 全站搜索」的傻瓜式结构。**纯前端重构**：后端 104 个 KV 设置键、`SYSTEM_SETTINGS_FIELD_MAP`、PUT 接口全部零改动；不向后兼容、直接替换（已确认）。

**已确认的 UI 决策**：默认落地页 = 概览（设置完成度清单）；功能卡「更多参数」默认折叠；左侧导航沿用现风格（分组带图标、可折叠、激活高亮），仅从三级压成两级。

## 新导航结构（6 顶级 = 概览叶子 + 5 分组，共 12 页）

```
概览（顶级叶子，默认页）
① 模型与连接  → 供应商与连接（卡片化） / 模型管理（合并原模型权限）
② 功能与工具  → 搜索与知识库（3 功能卡） / 工具与扩展（4 功能卡） / MCP 管理（原样）
③ 成员与安全  → 用户与注册（合并注册配额） / Skill 治理（审批+版本+绑定）
④ 系统与数据  → 品牌与界面 / 日志与审计（3 Tab） / 数据与维护
⑤ 高级设置    → 推理与网络（合并推理+网络，分区折叠）
```

## UI 形态（目标视觉，实现时以 shadcn/v2-panel 体系落地）

1. **搜索与知识库页**（功能卡样板）：每张功能卡 = 图标 + 白话标题 + 主开关 + 常用 3~5 项（引擎/结果数/Key 或 模型/取回数/相似度）+「更多参数」折叠（并发/双语/分块/保留天数等全部收进，默认收起）
2. **概览页**：保留 4 张状态卡 + 「待你完成」检查清单（模型接入/注册开放/搜索配置/默认模型，数据来自 useSystemSettings + useSystemConnections + useSystemModels）+ 每项「去配置 →」跳转 + 底部提示语"完成以上即可正常使用，其余参数保持默认"
3. **供应商与连接页**：6 个供应商模板卡（openai/openai_responses/azure_openai/ollama/google_genai/openai_interleave，以现有后端枚举为准，不做 70+ 市场）+ 配置抽屉（预填模板字段 → 验证连接 → 保存）+「高级管理」折叠（全部连接列表/导入导出/API Key 池）
4. **推理与网络页**：顶部警示"这里保持默认即可" + 推理链分区（常用项平铺）+ 流式与性能/网络与超时/Ollama 专属分区默认折叠 + 整页保存

## 页面合并/拆分映射表（旧 19 → 新 12）

| 新页 (key) | 来源（旧页 key） | 动作 |
|---|---|---|
| 概览 `overview` | overview | 升级：+完成度清单 +快捷入口（新默认页） |
| 供应商与连接 `connections` | connections | 重做：6 供应商模板卡 + 配置抽屉；原列表/导入导出入「高级管理」折叠 |
| 模型管理 `models` | models + api-routing | 合并：共享 `useSystemModels`，能力+访问控制同页分区 |
| 搜索与知识库 `search-knowledge` | web-search + rag + knowledge-base | 3 张 FeatureCard；Python 工具块移出 |
| 工具与扩展 `tools-extensions` | web-search(Python块) + python-runtime + skills(安装) + system-config(乱斗/标题总结) | 4 张 FeatureCard + 运行时管理折叠 |
| MCP 管理 `mcp` | mcp | 原样保留（6 子 Tab 已是场景内分组范例） |
| 用户与注册 `users-registration` | members + system-config(注册/配额) | 合并：用户列表 + 注册策略/配额卡 |
| Skill 治理 `skills-governance` | skills(审批/版本/绑定) | 保留 3 section；安装 section 移出 |
| 品牌与界面 `branding` | system-config(头像/品牌/提示词/siteBaseUrl) | 新建聚合页 |
| 日志与审计 `logs-audit` | audit + task-trace + system-logs | 复用 SystemSkillAudits 3 Tab 模式（TaskTraceConsole/SystemLogsPage 已整组件内嵌先例） |
| 数据与维护 `data-maintenance` | backup + system-config(保留/压缩) | 合并：保留/压缩/并发/追踪设置/日志设置卡片 |
| 推理与网络 `reasoning-network` | token-management + network | 合并，常用平铺 + 高级折叠，整页保存 |

废弃旧 key：`api-routing`、`token-management`、`system-config`、`network`、`web-search`、`rag`、`knowledge-base`、`python-runtime`、`skills`、`members`、`audit`、`task-trace`、`system-logs`、`backup`（localStorage 旧值由既有非法 key 回退机制兜底，`renderSystemLeaf()===null` 校验天然兼容）。

## 关键实现点

### 1. 导航与注册表（shell 零改动）
- `system-settings-registry.tsx`：重写 `systemSettingsTree`（两级：5 分组 + 顶级概览叶子）+ `leafComponentMap`（新 key 映射，复用现有组件为主）；`SystemLeafMeta` 增加 `keywords?: string[]`（搜索用）；`DEFAULT_SYSTEM_LEAF = "overview"`
- `nav.tsx`：`buildSystemChildren()` 输出 2 级（分组→叶子），去掉 system 外壳层级
- `settings-layout-client.tsx`：新增 `systemMain` 状态（当前顶级分组），`activeMain`/`onChangeMain` 真实接入；shell 的 `itemRootKey` 同步逻辑已支持顶级叶子（概览），无需改 shell
- `system-settings.tsx` / `settings-dialog.tsx`：key 校验逻辑不变，仅跟随新 key 集

### 2. 新建通用组件（`components/settings/components/`）
- `feature-card.tsx`：功能卡（icon+标题+白话描述+主开关+内容区+「更多参数」Collapsible，**默认折叠**），样式沿用 v2-panel/SettingRow 体系，折叠交互提取自现成 `CollapsibleEditorSection`
- `settings-search.tsx`：导航顶部搜索框（Input + 内联结果列表，基于已有 `command.tsx` cmdk 原语），匹配叶子 label + keywords，点击跳转对应叶子

### 3. 页面重组（以"整组件内嵌 + 设置行迁移"为主）
- 搜索与知识库：WebSearch 拆分（引擎/Key/白名单=常用；并发/双语/Metaso=折叠；Python 块移除）、RAG 拆分（embedding/TopK/阈值=常用；性能/分块/保留=折叠）、KnowledgeBase 整体内嵌为卡
- 工具与扩展：Python 参数卡 + 运行时管理折叠（复用 SystemPythonRuntime 内部区块）+ Skill 安装卡 + 乱斗/标题总结卡（从 SystemGeneralPage 拆出对应区块）
- 数据与维护：SystemMonitoring 3 卡 + GeneralPage 保留/压缩卡迁移
- 模型管理：SystemModelsPage + SystemModelAccess 上下分区（共享 useSystemModels）
- 日志与审计：改 SystemSkillAudits 为泛化 tab 容器（AUDIT_TABS 复用）
- 保存语义：沿用现有"每页/每卡保存"模式，不改变后端 PUT 语义

### 4. 概览页升级
- 保留 4 状态卡 + 「待你完成」检查清单 + 「去配置 →」跳转（经 `aichat:system-settings-select` 事件 + layout 状态切换叶子）

### 5. 个人设置整理（范围已确认）
- 修正渲染顺序与导航一致（shares 移到 security 前）；统一分区卡片风格、补全白话副标题；About 保留

### 6. 事件与持久化
- `settings:system:v2-module` / `settings:lastSub` 中旧 key 由既有回退逻辑处理；`aichat:system-settings-select` 事件 key 校验天然适配

## 测试策略（TDD，红-绿-重构）

- 更新 `system-settings-registry.test.tsx`（新树结构断言：6 顶级、12 叶子、key 唯一）
- 更新 `system-settings-pages.test.tsx` 快照；新增 feature-card / settings-search / 概览完成度测试
- 合并页沿用现有页面测试模式（渲染 + 交互）
- 每个 PR 跑 `vitest` + `tsc --noEmit` + eslint

## 实施阶段（每阶段独立 PR，各自 code-review 后合并 main）

- **阶段 1（PR-1）**：注册表/导航结构落地——新 12 页 key + 两级导航 + DEFAULT=overview + 旧页面组件原样挂到新位置 + 测试更新。验收：导航两级、12 页可切换、无回归
- **阶段 2（PR-2）**：页内整合——搜索与知识库 / 工具与扩展 / 推理与网络 / 数据与维护 / 模型管理 / 用户与注册 / 品牌与界面 / Skill 治理 / 日志与审计 合并落地 + FeatureCard 折叠
- **阶段 3（PR-3）**：体验增强——全站搜索框、概览完成度、供应商卡片式配置、白话副标题补全、个人设置整理
- 每阶段实施时调用 `ui-ux-pro-max` 做设计系统/交互/可访问性检查；整个流程按 superpowers subagent-driven-development + /code-review 执行

## 明确不做（非目标）

- 后端设置键、接口、字段映射零改动；不做数据迁移
- 不引入新依赖（cmdk/collapsible/command 均已有）
- 不做 70+ 供应商市场（后端仅支持 6 个 provider 枚举）
- 不改聊天页高频控件就近放置（模型菜单等属另一话题，不在本计划）

## 风险与对策

- 快照/树结构测试大面积失败 → 随阶段 1 一并更新
- 合并页保存语义差异 → 保持各卡独立保存，不做整页原子保存
- Dialog 与路由页状态不同步（既有隐患）→ 本计划不扩大范围，仅保证新 key 集下两入口一致可用

---

# 阶段 1 任务拆分（PR-1：注册表/导航结构落地）

## Task 1 — 注册表重写：新 12 页树 + 映射表 + 测试（TDD）

文件（仅这两个）：
- `packages/frontend/src/components/settings/system-settings-registry.tsx`
- `packages/frontend/src/components/settings/__tests__/system-settings-registry.test.tsx`

### 1. 类型改造

- `SystemLeafMeta` 增加 `keywords?: string[]`（搜索用，本阶段就填上合理值）
- 分组类型沿用 `SystemWorkspaceNode`（key/label/icon/children）
- 新增顶层条目联合类型（叶子 | 分组），`systemSettingsTree` 改为该类型数组

### 2. 新导航树（6 顶级 = 概览叶子 + 5 分组，共 12 叶子）

```
{ key: "overview", label: "概览", icon: LayoutDashboard, keywords: ["首页","完成度","待办"] }   // 顶级叶子
{ key: "model-connections", label: "模型与连接", icon: Cable, children: [
    { key: "connections", label: "供应商与连接", icon: PlugZap, keywords: ["provider","API Key","openai","ollama","azure","google","密钥"] },
    { key: "models", label: "模型管理", icon: Boxes, keywords: ["模型权限","能力","访问控制"] },
]},
{ key: "features-tools", label: "功能与工具", icon: Wrench, children: [
    { key: "search-knowledge", label: "搜索与知识库", icon: Search, keywords: ["联网搜索","web search","RAG","知识库","嵌入"] },
    { key: "tools-extensions", label: "工具与扩展", icon: Terminal, keywords: ["Python","运行时","Skill 安装","乱斗","标题总结"] },
    { key: "mcp", label: "MCP 管理", icon: Link2, keywords: ["模型上下文协议","连接","工具"] },
]},
{ key: "members-security", label: "成员与安全", icon: ShieldCheck, children: [
    { key: "users-registration", label: "用户与注册", icon: Users, keywords: ["成员","注册","配额","额度"] },
    { key: "skills-governance", label: "Skill 治理", icon: Puzzle, keywords: ["审批","版本","绑定","安装"] },
]},
{ key: "system-data", label: "系统与数据", icon: Database, children: [
    { key: "branding", label: "品牌与界面", icon: Palette, keywords: ["品牌","头像","提示词","站点","siteBaseUrl"] },
    { key: "logs-audit", label: "日志与审计", icon: ScrollText, keywords: ["审计","任务追踪","运行日志","日志"] },
    { key: "data-maintenance", label: "数据与维护", icon: HardDrive, keywords: ["备份","保留","压缩","监控"] },
]},
{ key: "advanced", label: "高级设置", icon: SlidersHorizontal, children: [
    { key: "reasoning-network", label: "推理与网络", icon: BrainCircuit, keywords: ["推理","token","流式","网络","超时","ollama"] },
]}
```

图标可用性已核验（lucide-react 全部存在）：LayoutDashboard、Cable、PlugZap、Boxes、Wrench、Search、Terminal、Link2、ShieldCheck、Users、Puzzle、Database、Palette、ScrollText、HardDrive、SlidersHorizontal、BrainCircuit。

### 3. leafComponentMap 新 key 映射（旧组件原样叠挂，保证无回归）

| 新 key | 挂载组件（按序叠挂，`space-y-6` 分隔） |
|---|---|
| overview | SystemOverviewContent |
| connections | SystemConnectionsPage |
| models | SystemModelsPage + SystemModelAccessPage |
| search-knowledge | SystemWebSearchPage + SystemRAGPage + SystemKnowledgeBasePage |
| tools-extensions | SystemPythonRuntimePage |
| mcp | SystemMcpPage |
| users-registration | SystemUsersPage |
| skills-governance | SystemSkillsPage |
| branding | SystemGeneralPage |
| logs-audit | SystemSkillAuditsPage（内含 task-trace/system-logs Tab，天然覆盖） |
| data-maintenance | SystemMonitoringPage |
| reasoning-network | SystemReasoningPage + SystemNetworkPage |

叠挂实现：注册表文件内定义一个小型包装组件（如 `StackedPages({ pages })`），遍历渲染各页；本阶段临时手段，阶段 2 将被 FeatureCard 整合取代。

### 4. 常量与工具函数

- `DEFAULT_SYSTEM_LEAF = "overview"`
- `renderSystemLeaf` 逻辑不变（leafComponentMap 查不到返回 null）
- `getWorkspaceForLeaf(leafKey)`：返回叶子所属**顶级条目 key**——分组内叶子返回分组 key；顶级叶子（overview）返回自身 key；查不到返回 undefined
- `getAllSystemLeafKeys()`：全部 12 个叶子 key（分组取 children、叶子取自身）

### 5. 测试（先红后绿：先更新测试文件并运行看到失败，再改注册表实现到全绿）

`system-settings-registry.test.tsx` 重写断言：
- 树 6 个顶级条目；第一个是概览叶子（无 children）
- 5 个分组 label 与 key 正确；每个分组 children 数量正确（2/3/2/3/1）
- 12 个叶子 key 全局唯一；`getAllSystemLeafKeys()` 恰好 12 个
- 每个新 key `renderSystemLeaf` 非空；废弃旧 key（api-routing/token-management/system-config/network/web-search/rag/knowledge-base/python-runtime/skills/members/audit/task-trace/system-logs/backup）`renderSystemLeaf` 返回 null；unknown key 返回 null
- `DEFAULT_SYSTEM_LEAF === "overview"`
- `getWorkspaceForLeaf`：overview→"overview"；connections/models→"model-connections"；search-knowledge/tools-extensions/mcp→"features-tools"；users-registration/skills-governance→"members-security"；branding/logs-audit/data-maintenance→"system-data"；reasoning-network→"advanced"；unknown→undefined
- 每个叶子有 label 与 icon；keywords 存在（搜索阶段用）

### 验证

- `npx vitest run src/components/settings/__tests__/system-settings-registry.test.tsx` 全绿
- `npx tsc --noEmit` 无错误
- 不触碰 nav.tsx / shell.tsx / layout / dialog / system-settings.tsx

## Task 2 — 导航与布局接入 + 分组图标渲染（PR-1）

文件：
- `packages/frontend/src/components/settings/nav.tsx`
- `packages/frontend/src/app/main/settings/_components/settings-layout-client.tsx`
- `packages/frontend/src/components/settings/shell.tsx`（仅加分组行图标）
- 测试：`__tests__/settings-shell-3level.test.tsx`（给树补 icon 断言覆盖新渲染）

### 1. nav.tsx

`buildSystemChildren()` 改为输出 `systemSettingsTree` 的 6 个顶级条目（叶子直接映射、分组带 children），不再包一层 system 外壳。`settingsNav` 的 system 条目 children 即该输出（对话框主层 personal/system 保留不变）。

### 2. settings-layout-client.tsx（系统设置部分）

- `systemTree` 改为取 `settingsNav` 中 system 的 `children`（6 个条目），不再包 `[sys]`
- 新增 `systemMain` state，初始值 `DEFAULT_SYSTEM_LEAF`
- `SettingsShell` 传 `activeMain={systemMain}`、`onChangeMain={setSystemMain}`（原硬编码 "system" 与空函数删除）
- `aichat:system-settings-active` 事件处理器里，`setSystemSub(detail.key)` 之外同步 `setSystemMain(getWorkspaceForLeaf(detail.key) ?? systemMain)`（保证从概览「去配置」跳转后分组高亮正确）
- 个人设置部分逻辑不动

### 3. shell.tsx（仅分组行图标）

- depth-0 顶级折叠行（hasChildren）与 depth>=1 分组行：在 chevron 与 label 之间渲染 `item.icon`（若存在），样式与叶子图标一致（`h-[1.125rem] w-[1.125rem] shrink-0`）
- 其余逻辑零改动

### 4. 测试

- `settings-shell-3level.test.tsx`：给树条目补 icon，新增断言分组行渲染图标（现有断言保持通过）
- 跑全 settings 相关测试：`npx vitest run src/components/settings src/components/system-settings.tsx src/app/main/settings`（含 registry、pages 快照、activate-key、shell 两个、3level）
- 快照 `system-settings-pages.test.tsx.snap` 若因页面组件未动不应变化；若意外失败需甄别原因而非盲目更新
- `npx tsc --noEmit` 无错误
- `npx eslint`（若仓库配了 next lint）相关文件无错误

### 验收（阶段 1 整体）

导航两级（概览 + 5 分组→叶子）、12 页可切换、旧 18 页全部可达（无回归）、对话框入口同步可用。
