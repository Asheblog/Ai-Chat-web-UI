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

---

# 阶段 2 任务拆分（PR-2：页内整合）

## Task 3 — FeatureCard 通用功能卡组件 + 测试

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/components/feature-card.tsx`
- 新建 `packages/frontend/src/components/settings/__tests__/feature-card.test.tsx`

### 组件规格

```tsx
export function FeatureCard({
  icon,              // LucideIcon，卡片左上角图标
  title,             // 白话标题（如 "联网搜索"）
  description,       // 白话副标题（如 "在回答前自动检索网页，支持多引擎并行"）
  enabled,           // 可选：主开关值（受控）
  onEnabledChange,   // 可选：主开关回调 (checked: boolean) => void
  moreLabel,         // 可选，默认 "更多参数"
  more,              // 可选：折叠区内容（默认收起）
  footer,            // 可选：卡底部操作区（保存按钮等）
  children,          // 常用内容区（SettingRow 等）
}: FeatureCardProps)
```

### 视觉与交互要求（沿用 v2-panel / CollapsibleEditorSection 体系）

1. 卡片外壳：`v2-panel`（与 settings 各页一致），内部 `flex flex-col`
2. 头部行：左 = 图标瓦片（`h-9 w-9 rounded-[8px] bg-primary/10 text-primary` 内放 icon）+ 标题（`text-base font-semibold`）+ 描述（`text-sm text-muted-foreground`）；右 = 主开关（`Switch`，带可访问标签：`aria-label={"启用" + title}`）；仅当 `enabled`/`onEnabledChange` 同时提供时渲染开关
3. 内容区：`children`（`px-4 py-4 space-y-3` 类区域，实际用 `space-y-3` 包裹）
4. 「更多参数」折叠：内容区之后一行按钮（`aria-expanded` + `ChevronDown` 旋转 180°，参考 `SystemConnectionEditorParts.tsx:104-139` 的 CollapsibleEditorSection 交互），文案 = `moreLabel`；**默认收起**；点击展开/收起（内部 useState 或受控均可，内部状态即可）
5. footer：`border-t border-border px-4 py-3` 区域，仅在提供 footer 时渲染
6. `icon`、`title` 必填；其余全部可选（`enabled` 与 `onEnabledChange` 必须成对出现，否则视为未提供开关——用类型或文档约束，二选一，倾向类型可选+文档说明）

### 测试（TDD，先红后绿）

`feature-card.test.tsx`：
1. 渲染 icon 瓦片、标题、描述、children
2. 提供 enabled/onEnabledChange 时渲染 Switch，点击触发回调
3. 未提供开关 props 时不渲染 Switch
4. 「更多参数」默认收起：more 内容不可见（不在文档中）；点击按钮后可见；aria-expanded 正确翻转；再点收起
5. 未提供 more 时不渲染「更多参数」按钮
6. footer 仅在提供时渲染
7. 不渲染 more/footer 时无多余 DOM（对照快照或 queryBy 断言均可，倾向行为断言）

### 验证

- `npx vitest run src/components/settings/__tests__/feature-card.test.tsx` 全绿
- `npx tsc --noEmit` 无错误
- 不触碰其他任何文件

## Task 4 — 搜索与知识库页（SearchKnowledgePage，3 张 FeatureCard）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/SearchKnowledgePage.tsx`
- 新建 `packages/frontend/src/components/settings/__tests__/search-knowledge-page.test.tsx`
- 不触碰其他文件（旧三页在 Task 13 删除；注册表在 Task 13 重映射）

### 源文件（已勘察，行号为区块地图依据）

- `pages/SystemWebSearch.tsx`（867 行）：11 个区块；页面级保存按钮「保存联网搜索设置」（845-864，dirty 跟踪 changed 215-244）；纯函数 `normalizeEngineList`(33-50)/`normalizeEngineOrder`(52-61)/`normalizeDomains`(63-67)/`arraysEqual`(69-70)、`ENGINE_OPTIONS`(24-29)、`mergeStrategy`(31)
- `pages/SystemRAG.tsx`（779 行）：v2-panel 主区(420-620)；保存按钮(627)恒可用；`ranges`(104-115)；文档管理 Dialog(630-776) 需整体保留
- `pages/SystemKnowledgeBase.tsx`（975 行）：v2-panel(541-693) + 保存设置(695-697) + 创建 Dialog(699-735) + 详情 slide-over(737-972) 需整体保留；`calculateTimeout`(70-74)/`getStageText`(77-94)/`MAX_FILE_SIZE_MB`(66)
- 三页共享 `useSystemSettings` 模式；`@/features/settings/shared` 的 `parseNumericInput`/`formatDateTime`/`formatFileSize`

### 新页结构

```
SearchKnowledgePage
├─ 页头：标题「搜索与知识库」+ 白话副标题（一行，如 "配置联网搜索、文档解析与知识库"）
├─ ① 联网搜索 FeatureCard（icon Globe，标题「联网搜索」，desc「在回答前自动检索网页，支持多引擎并行」）
│    主开关：启用联网搜索 → webSearchAgentEnable
│    常用区：启用搜索引擎（勾选网格 ENGINE_OPTIONS，含已配置 Key 徽标）→ webSearchEnabledEngines
│          引擎优先顺序（上下移）→ webSearchEngineOrder
│          每次融合结果数 → webSearchResultLimit
│          域名白名单（Textarea）→ webSearchDomainFilter
│          API Key 网格（Tavily/Brave/Metaso/Exa，draft+清除+已配置状态）→ webSearchApiKey*
│    「更多参数」折叠（默认收起）：
│          并行数值网格（并行引擎上限/单次查询扩展数/并行检索超时）→ webSearchParallel*
│          自动双语检索 + 双语扩展策略 + 自动网页读取并发 → webSearchAutoBilingual* / webSearchAutoReadParallelism
│          Metaso 专属块（仅启用 metaso 时渲染）→ webSearchScope / webSearchIncludeSummary / webSearchIncludeRaw
│    footer：保存按钮「保存联网搜索设置」（沿用原 dirty 跟踪与校验；payload 去掉全部 python* 与 agentMaxToolIterations/chatDynamicSkillRuntimeEnabled）
├─ ② RAG 解析 FeatureCard（icon FileText，标题「RAG 文档解析」，desc「附加文档后，AI 基于文档内容回答」）
│    主开关：启用 RAG 文档解析 → ragEnabled
│    （启用时渲染）Embedding 模型选择（Popover+Command，filteredModels/hasEmbeddingModels 逻辑与提示 Alert 保留）→ ragEmbeddingConnectionId/ragEmbeddingModelId
│    常用区：检索参数（TopK/相关性阈值/上下文 Token 限制）→ ragTopK/ragRelevanceThreshold/ragMaxContextTokens
│    「更多参数」折叠：Embedding 性能（批量/并发）→ ragEmbeddingBatchSize/ragEmbeddingConcurrency
│          文档分块（分块大小/重叠/最大文件 MB/最大页数）→ ragChunkSize/ragChunkOverlap/ragMaxFileSizeMb/ragMaxPages
│          存储管理（保留天数）→ ragRetentionDays
│    footer：文档管理（打开文档 Dialog）+ 保存设置（沿用原 payload 与 clamp 逻辑）
├─ ③ 知识库 FeatureCard（icon BookOpen，标题「知识库」，desc「创建和管理持久化知识库，供所有用户使用」）
│    主开关：启用知识库功能 → knowledgeBaseEnabled
│    内容区：用户权限（匿名/注册 2 开关，启用时渲染）→ knowledgeBaseAllowAnonymous/knowledgeBaseAllowUsers
│          知识库列表（刷新/新建/表格/行菜单，skeleton/空态保留）
│    footer：保存设置（3 key payload）
└─ 两个 Dialog（RAG 文档管理、知识库创建）与知识库详情 slide-over 移至页面层，原样保留
```

### 实现要点

1. **单次 useSystemSettings**：页面级一个 hook 调用；三卡共用 `settings/refresh/update/isLoading/error`；loading 时渲染一个共享骨架（沿用源页面 Skeleton 结构）；error 时一个共享错误+重试块
2. **数据获取**：RAG 卡保留 `useModelsStore` + 文档列表 fetch；KB 卡保留 fetchKnowledgeBases/fetchKbDetail 与 5s 轮询 effect（详情打开且文档 pending/processing 时）
3. **行 JSX 原样搬移**：内容区行容器样式沿用源页面（不要用 SettingRow 完整卡片样式嵌套进 v2-panel，避免双重边框；FeatureCard 已是 v2-panel 外壳）；源页面若原本用 SettingRow 则继续用 SettingRow
4. **Python 块从联网搜索卡移除**（SystemWebSearch.tsx 760-843 及其 state 104-109/142-147/191-213/230-236/277-281/314-331/855-859 全部不进入本页；这些 key 属于 Task 5 工具与扩展页）
5. **纯函数与常量**：normalizeEngineList/normalizeEngineOrder/normalizeDomains/arraysEqual/ENGINE_OPTIONS/mergeStrategy/ranges/calculateTimeout/getStageText/MAX_FILE_SIZE_MB 等随卡迁移（模块内保留，不必导出）
6. 保存语义不变：联网搜索卡 dirty 跟踪；RAG/KB 卡恒可用；toast 文案沿用（"联网搜索设置已保存"等）

### 测试（TDD，先红后绿）

`search-knowledge-page.test.tsx`（mock：`@/hooks/use-system-settings`、`@/store/models-store`、`@/components/ui/use-toast`、`@/lib/api`（apiHttpClient）、`next/navigation`；复用 `system-settings-pages.fixtures.ts` 的 baseSettings 思路，必要时本地扩展 rag/knowledgeBase key）：

1. 页面渲染三张卡（联网搜索/RAG 文档解析/知识库标题可见）
2. 联网搜索卡「更多参数」默认收起：并行数值/双语/Metaso 不可见；点击后可见
3. RAG 卡「更多参数」默认收起：性能/分块/保留不可见；点击后可见
4. 联网搜索保存 payload：包含 webSearchAgentEnable/webSearchEnabledEngines/webSearchEngineOrder/webSearchResultLimit/webSearchDomainFilter/webSearchScope/webSearchIncludeSummary/webSearchIncludeRaw/webSearchParallel*/webSearchAutoBilingual* 等，**且不包含任何 pythonTool*/agentMaxToolIterations/chatDynamicSkillRuntimeEnabled**（断言 `expect(payload).not.toHaveProperty('pythonToolEnable')` 等）
5. RAG 卡保存 payload：ragEnabled/ragEmbeddingConnectionId/ragEmbeddingModelId/ragTopK/ragRelevanceThreshold/ragMaxContextTokens/ragChunkSize/ragChunkOverlap/ragMaxFileSizeMb/ragMaxPages/ragRetentionDays/ragEmbeddingBatchSize/ragEmbeddingConcurrency
6. 知识库卡保存 payload：knowledgeBaseEnabled/knowledgeBaseAllowAnonymous/knowledgeBaseAllowUsers
7. 主开关联动：关闭联网搜索主开关后保存，payload 中 webSearchAgentEnable=false
8. 默认渲染：settings 为 null（isLoading=true）时显示加载骨架，不崩溃

### 验证

- `npx vitest run src/components/settings/__tests__/search-knowledge-page.test.tsx` 全绿
- 既有测试不受影响：`npx vitest run src/components/settings` 全绿（旧三页与旧测试仍存在，本任务不删）
- `npx tsc --noEmit`；`npx next lint` 新增文件无错误

## Task 5 — 工具与扩展页（ToolsExtensionsPage，5 张卡）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/tools-extensions/ToolsExtensionsPage.tsx`（页壳，薄）+ 同目录卡组件文件（每文件 ≤700 行，参照 Task 4 拆分结构）
- 新建 `packages/frontend/src/components/settings/__tests__/tools-extensions-page.test.tsx`
- 不触碰其他文件（源页面 Task 13 删除）

### 源区块（区块地图行号）

- **Python 参数**：`pages/SystemWebSearch.tsx` 760-843（JSX）+ 相关 state 104-109 / 水合 142-147 / 校验 191-213（pythonTimeoutRange/pythonOutputRange/agentIterationRange + pythonTimeoutValid/pythonMaxOutputValid/pythonMaxSourceValid/agentIterationValid + defaultToolIterations）/ changed 230-236 / payload 314-331（pythonToolEnable、chatDynamicSkillRuntimeEnabled、pythonToolTimeoutMs、pythonToolMaxOutputChars、pythonToolMaxSourceChars、agentMaxToolIterations）
- **运行时管理**：`pages/SystemPythonRuntime.tsx`（473 行，全 API 驱动，无 settings key）：状态卡 260-276、索引配置 278-333、安装依赖 335-350、卸载 352-366、Reconcile 369-377、冲突告警 379-390、已安装包表 392-470；`@/features/settings/api` 5 个函数（getPythonRuntimeStatus/updatePythonRuntimeIndexes/installPythonRuntimeRequirements/uninstallPythonRuntimePackages/reconcilePythonRuntime）；`splitList`/`normalizePackageName`/`SOURCE_ORDER`/`SOURCE_LABELS`(21-35)
- **Skill 安装**：`pages/SystemSkills.tsx` 的安装 state（installSource/installToken/installing/refreshing 222-245）+ 安装逻辑 312-315（installSkillFromGithub）+ JSX 551-560；子组件 `pages/system-skills/SkillInstallSection.tsx`（受控组件，props: installSource/installToken/installing/refreshing/onInstallSourceChange/onInstallTokenChange/onInstall/onRefresh）直接复用
- **乱斗/标题**：`features/settings/pages/system-general/SystemGeneralPage.tsx` 模型大乱斗区块 452-521（battleAllowAnonymous/battleAnonymousDailyQuota/battleAllowUsers/battleUserDailyQuota）与标题智能总结区块 755-825（titleSummaryEnabled/titleSummaryMaxLength/titleSummaryModelSource）；draft/校验/fieldChanged 模式参照该文件 202-333

### 新页结构（页壳 + 5 卡，全部 FeatureCard）

```
ToolsExtensionsPage
├─ 页头：标题「工具与扩展」+ 白话副标题（如 "Python 计算、Skill 安装与增强功能"）
├─ ① Python 工具 FeatureCard（icon Terminal，标题「Python 工具」，desc「允许 AI 在本地沙箱中执行 Python 代码」）
│    主开关：启用 Python 工具 → pythonToolEnable（主开关打开时渲染常用区/折叠区，仿源 769-777 的联动；关闭时行禁用或隐藏，参照源行为）
│    常用区：超时时间(毫秒)/stdout 截断字符数/代码长度限制 → pythonToolTimeoutMs/pythonToolMaxOutputChars/pythonToolMaxSourceChars
│    「更多参数」折叠：聊天侧第三方动态 Skill Runtime 开关 → chatDynamicSkillRuntimeEnabled
│          Agent 工具最大迭代次数（0=无限制）→ agentMaxToolIterations
│    footer：保存按钮「保存 Python 工具设置」（dirty 跟踪 + 源校验范围，payload 6 key）
├─ ② Python 运行时管理 FeatureCard（icon FlaskConical，标题「Python 运行时管理」，desc「索引源、依赖安装与已安装包」；无主开关）
│    more（默认收起）= 运行时管理全部区块：状态卡（含就绪/包数徽标与 issue Alert）→ 索引配置（主索引/额外索引/trusted-host/自动安装×2 + 保存索引配置按钮）→ 安装依赖 + 卸载包 → Reconcile 立即执行 → 冲突告警 → 已安装包表（来源筛选）
│    （源 SystemPythonRuntime.tsx 内容原样搬移，去掉其外层页头 250-258；状态/API 逻辑逐字保留）
├─ ③ Skill 安装 FeatureCard（icon Download，标题「Skill 安装」，desc「从 GitHub 仓库安装系统级 Skill」）
│    内容区：<SkillInstallSection />（受控复用，state 与 installSkillFromGithub 逻辑从 SystemSkills.tsx 迁入）
├─ ④ 模型大乱斗 FeatureCard（icon Swords，标题「模型大乱斗」，desc「控制乱斗功能的访问与每日次数」）
│    内容区：4 行（匿名开关+匿名每日额度 / 注册开关+注册每日额度）→ battleAllowAnonymous/battleAnonymousDailyQuota/battleAllowUsers/battleUserDailyQuota
│    footer：保存按钮「保存乱斗设置」（dirty 跟踪 + 配额 ≥0 整数校验）
├─ ⑤ 标题智能总结 FeatureCard（icon Type，标题「标题智能总结」，desc「使用 AI 自动为对话生成简洁标题」）
│    内容区：启用开关（实验性 Badge）/ 标题最大长度（5-50 clamp）/ 模型来源 Select(current/specified)
│    footer：保存按钮「保存标题总结设置」（3 key）
└─ 无 Dialog
```

### 实现要点

1. 页壳单一 `useSystemSettings`，共享 loading 骨架/错误重试块（仿 Task 4 SearchKnowledgePage 页壳模式，先读它）
2. 卡 props 收 `{ settings, update }`（不要声明不用的 refresh/isLoading——Task 4 评审已指出这是死 props）
3. 乱斗/标题卡的 draft/校验/fieldChanged 模式从 SystemGeneralPage 202-333 适配（每卡自己的 normalizedInitials + 保存 disabled 逻辑 + 还原按钮保留——还原重置该卡 drafts）
4. Python 卡沿用源校验与 clamp；`changed` 只含 python 相关项
5. 保存语义：各卡独立保存，toast 文案沿用源（"Python 工具设置已保存"类；无源的用「保存成功」风格统一——按现有 toast 惯例）
6. 全部行 JSX 沿用源样式；不引入新依赖

### 测试（TDD，先红后绿）

`tools-extensions-page.test.tsx`（mock：useSystemSettings/useToast/@/features/settings/api/@/features/skills/api；baseSettings 复用 fixtures，本地补 python key 缺省默认值）：
1. 渲染 5 张卡标题（Python 工具/Python 运行时管理/Skill 安装/模型大乱斗/标题智能总结）
2. Python 卡保存 payload = 6 key 精确断言；主开关关闭时 payload pythonToolEnable=false
3. Python 卡「更多参数」默认收起（chatDynamicSkillRuntimeEnabled/agentMaxToolIterations 不可见）→ 点击展开可见
4. 运行时管理默认收起（索引配置不可见）→ 点击展开可见「保存索引配置」按钮（API 交互测试选做，展开可见性为主）
5. 乱斗卡保存 payload 4 key；非法值（-1）阻止并 toast
6. 标题卡保存 payload 3 key
7. 加载骨架渲染
8. 还原按钮：修改后点还原，保存按钮回到 disabled（dirty 跟踪行为）

### 验证

- `npx vitest run src/components/settings/__tests__/tools-extensions-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿（旧文件未动）
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 6 — 推理与网络页（ReasoningNetworkPage，整页保存）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/reasoning-network/ReasoningNetworkPage.tsx`（页壳，薄）+ 同目录分区组件（每文件 ≤700 行）
- 新建 `packages/frontend/src/components/settings/__tests__/reasoning-network-page.test.tsx`
- 不触碰其他文件（旧两页 Task 13 删除）

### 源文件（区块地图行号）

- `pages/SystemReasoning.tsx`（347）：单节「推理链配置」，13 行 SettingRow；保存按钮(341-343) 仅 isLoading 禁用；校验在 handleSave(70-160)：自定义标签 JSON 校验(71-85)、parseInterval(86-99 空→0、整数≥0)、maxTokens 1-256000(110-125 空→null clamp)、温度 0-2(127-142 空→null)；状态 23-35；水合 45-68；`parseDeltaChunkSize`(37-42)
- `pages/SystemNetwork.tsx`（252）：单节「连接与超时」，8 行；保存(246-248) `disabled={!changed || 任一范围无效}`；`changed` 92-101 对照 settings 默认；每字段 重置/禁用 按钮 143/160/177/194/211/228；范围 79-84、有效标志 85-90；`msToSec`/`within`(77-78)
- 两者共用 useSystemSettings + useToast + SettingRow + parseNumericInput

### 新页结构（页壳 + 4 个 FeatureCard 分区 + 页级保存）

```
ReasoningNetworkPage
├─ 页头：标题「推理与网络」+ 白话副标题
├─ 顶部警示（v2-panel-soft 或 Alert 风格，仿既有警示样式）：「这里保持默认即可，调整前请确认你了解这些参数的影响。」
├─ ① 推理链配置 FeatureCard（icon Brain，标题「推理链配置」，desc「控制模型思考过程与默认生成参数」；无主开关）
│    内容区（常用平铺 6 行）：启用推理链 → reasoningEnabled / 默认展开 → reasoningDefaultExpand / 保存到数据库 → reasoningSaveToDb
│          默认生成 Tokens → reasoningMaxOutputTokensDefault（+恢复默认）/ 默认温度 → temperatureDefault（+恢复默认）
│          标签模式 Select + 自定义标签 JSON 输入（conditional）→ reasoningTagsMode/reasoningCustomTags
├─ ② 流式与性能 FeatureCard（icon Zap，标题「流式与性能」；无主开关）
│    moreLabel「更多参数」，more（默认收起）= 5 行：分片大小 → streamDeltaChunkSize / 正文 flush 间隔 → streamDeltaFlushIntervalMs
│          推理 flush 间隔 → streamReasoningFlushIntervalMs / Keepalive 间隔 → streamKeepaliveIntervalMs
│          OpenAI reasoning_effort Select → openaiReasoningEffort
├─ ③ Ollama 专属 FeatureCard（icon Bot，标题「Ollama 专属」；无主开关）
│    moreLabel「更多参数」，more（默认收起）= 1 行：Ollama think → ollamaThink
├─ ④ 网络与超时 FeatureCard（icon Network，标题「网络与超时」；无主开关）
│    moreLabel「更多参数」，more（默认收起）= 8 行：SSE 心跳间隔 → sseHeartbeatIntervalMs / 上游最大空闲 → providerMaxIdleMs
│          推理初始宽限 → providerInitialGraceMs / 推理阶段空闲上限 → providerReasoningIdleMs
│          推理保活提示间隔 → reasoningKeepaliveIntervalMs / 上游总体超时 → providerTimeoutMs
│          推送用量 Switch → usageEmit / 仅透传厂商 usage Switch → usageProviderOnly（usageEmit 关闭时禁用）
│          每字段 重置/禁用 按钮保留（仿源 143-228）
└─ 页脚：保存按钮「保存设置」（整页单保存；disabled 仅当 isLoading 或 全部未变更；payload = 13 + 8 = 21 key）
```

### 实现要点

1. 页壳单一 `useSystemSettings`；共享 loading 骨架/错误重试（仿 search-knowledge 页壳）
2. **整页一个保存**：payload 21 key 一次 PUT；校验合并自两源（温度 0-2、maxTokens 1-256000、interval 空→0 整数≥0、网络各范围 79-84、自定义标签 JSON）；toast 文案沿用（"自定义标签无效"、区间外描述等）
3. **dirty 跟踪**：页面级 `changed` = 21 个 draft 任一与 settings 不同（网络源 92-101 的模式扩展到整页）；全部未变更时保存 disabled
4. 折叠分区用 FeatureCard 的 `more`（moreLabel「更多参数」默认收起）；推理链配置卡内容平铺
5. 行 JSX 沿用源（SettingRow）；网络行每字段 重置/禁用 按钮保留
6. 状态：drafts 21 个 useState + 水合 effect；不要未使用 props

### 测试（TDD，先红后绿）

`reasoning-network-page.test.tsx`（mock：useSystemSettings/useToast；baseSettings 缺省值覆盖 reasoning/network key——参考 fixtures 已有 webSearch 系缺省的处理方式，必要时本地补）：
1. 渲染 4 分区标题 + 警示文案「这里保持默认即可」
2. 三个折叠分区默认收起（流式/网络/Ollama 内容不可见）→ 点击展开可见
3. 整页保存 payload = 21 key 精确断言（13 reasoning + 8 network 全量）
4. 温度非法（>2）→ toast + 不调用 update
5. 自定义标签非 JSON → toast「自定义标签无效」+ 不调用 update（继承源测试语义）
6. 网络值非法（sseHeartbeat=500 <1000）→ 保存 disabled 或 toast 阻断（按源行为：范围无效即 disabled）
7. dirty 行为：修改任一字段保存启用；还原（改回原值）后 disabled
8. 加载骨架渲染
9. ollamaThink 关闭/打开随保存生效（payload 断言）

### 验证

- `npx vitest run src/components/settings/__tests__/reasoning-network-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿（旧页未动）
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 7 — 数据与维护页（DataMaintenancePage，5 张卡）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/data-maintenance/DataMaintenancePage.tsx`（页壳，薄）+ 同目录卡组件（每文件 ≤700 行）
- 新建 `packages/frontend/src/components/settings/__tests__/data-maintenance-page.test.tsx`
- 不触碰其他文件（源页面 Task 13 删除）

### 源区块（区块地图行号）

- **保留/压缩**：`features/settings/pages/system-general/SystemGeneralPage.tsx` 品牌定制里的压缩 3 行 572-625（contextCompressionEnabled 572-587 / 触发阈值 589-606 / 保留消息数 608-625，后两者在开关关闭时 disabled 602/621）+ 数据保留策略 664-753（聊天图片保留天数+存储优化 Badge 674-696 → chatImageRetentionDays；乱斗历史保留天数 698-715 → battleRetentionDays；单条消息 AI 回答上限 717-734 → assistantReplyHistoryLimit；匿名访客数据保留天数 736-752 → anonymousRetentionDays）；校验 252-333（chatImageRetention ≥0、battleRetention 0-3650、replyHistoryLimit 1-20、anonymousRetention 0-15、compressionRatio 0.2-0.9、compressionTail 4-50）；draft/fieldChanged 模式 202-250
- **监控三卡**：`pages/SystemMonitoring.tsx` 并发生成控制 179-223（chatMaxConcurrentStreams 1-8，行内保存 203-220）/ 任务追踪 225-414（taskTraceEnabled 自动保存 241-250 + 重置 traceTotal、taskTraceDefaultOn 253-262、taskTraceAdminOnly 264-273、taskTraceEnv 275-294、taskTraceRetentionDays 310-321、taskTraceMaxEvents 339-352、taskTraceIdleTimeoutMs 370-383、立即清理 402-410、统计+查看日志 387-412）/ 系统运行日志 416-524（level 434-448、toFile 455-460、retentionDays 476-489、立即清理 512-520、统计 493-522）；`formatBytes`(171-175)；API `@/features/system/api` 6 函数（getTaskTraces/getSystemLogConfig/getSystemLogStats/cleanupTaskTraces/updateSystemLogConfig/cleanupSystemLogs）；管理页管理员闸门 105-111 本页**不保留**（系统设置区整体已管理员隔离，属冗余死代码，全局规则「删除过时/冗余代码」）

### 新页结构（页壳 + 5 张 FeatureCard）

```
DataMaintenancePage
├─ 页头：标题「数据与维护」+ 白话副标题（如 "数据保留、压缩、并发与日志维护"）
├─ ① 数据保留策略 FeatureCard（icon Clock，标题「数据保留策略」，desc「控制系统数据的自动清理规则」）
│    内容区 4 行：聊天图片保留天数（+存储优化 Badge）→ chatImageRetentionDays
│          乱斗历史保留天数 → battleRetentionDays / 单条消息 AI 回答上限 → assistantReplyHistoryLimit / 匿名访客数据保留天数 → anonymousRetentionDays
│    footer：保存按钮「保存保留策略」（dirty 跟踪 + 上述校验；payload 4 key）
├─ ② 上下文压缩 FeatureCard（icon Compress，标题「上下文压缩」，desc「对话过长时自动压缩，保留最近消息」）
│    内容区 3 行：启用压缩 Switch → contextCompressionEnabled（关闭时后两行 disabled）
│          压缩触发阈值 → contextCompressionThresholdRatio / 压缩后保留最近消息数 → contextCompressionTailMessages
│    footer：保存按钮「保存压缩设置」（payload 3 key，校验 0.2-0.9 / 4-50）
├─ ③ 并发生成控制 FeatureCard（icon Thermometer，标题「并发生成控制」，desc「限制同时进行的流式生成任务数」）
│    内容区 1 行：最大并发数 Input（1-8）+ 行内保存按钮（仿源 203-220，保存 payload { chatMaxConcurrentStreams }）
├─ ④ 任务追踪 FeatureCard（icon ShieldCheck，标题「任务追踪」，desc「记录后台任务执行，用于性能诊断」）
│    内容区：启用任务追踪 Switch（自动保存，关闭时重置 traceTotal）→ taskTraceEnabled
│          默认启用 → taskTraceDefaultOn / 仅限管理员 → taskTraceAdminOnly / 可用环境 Select → taskTraceEnv
│          保留天数（行内保存 1-365）→ taskTraceRetentionDays / 单条最大事件数（行内保存 100-200000）→ taskTraceMaxEvents
│          心跳超时告警（行内保存 1000-600000）→ taskTraceIdleTimeoutMs
│          统计行：traceTotal Badge + 查看日志（Link /main/logs/task-trace）+ 立即清理（destructive，cleanupTaskTraces）
├─ ⑤ 系统运行日志 FeatureCard（icon FileText，标题「系统运行日志」，desc「后端日志级别、文件输出与保留」）
│    内容区：日志级别 Select → { level }（updateSystemLogConfig）/ 写入文件 Switch → { toFile }
│          保留天数（行内保存）→ { retentionDays } / 立即清理（cleanupSystemLogs）
│          统计行：totalFiles/totalSizeBytes（formatBytes）+ 查看日志（Link /main/logs/system）
```

### 实现要点

1. 页壳单 useSystemSettings + 共享骨架/错误重试（仿 search-knowledge 页壳）；`@/features/system/api` 6 函数在页壳或相关卡内调用
2. 保存语义沿用源：保留/压缩卡 = 卡级保存（dirty + 校验 + toast）；并发/追踪/日志卡 = 行内保存/自动保存（原样）
3. 移除非管理员闸门（见上）；`formatBytes` 迁入日志卡模块
4. 行 JSX 沿用源；不引入新依赖；无未使用 props

### 测试（TDD，先红后绿）

`data-maintenance-page.test.tsx`（mock：useSystemSettings/useToast/@/features/system/api（getTaskTraces 等）；baseSettings 已有 chatImageRetentionDays/assistantReplyHistoryLimit/anonymousRetentionDays/battleRetentionDays，压缩 3 key 缺省由组件默认覆盖——参照 fixtures 惯例）：
1. 渲染 5 卡标题
2. 保留策略卡保存 payload 4 key 精确断言；battleRetentionDays=-2 阻断 + toast（继承源测试语义）
3. 压缩卡保存 payload 3 key；关闭启用开关后阈值/保留输入 disabled
4. 并发卡行内保存 payload { chatMaxConcurrentStreams }
5. 任务追踪：启用开关切换触发 update({ taskTraceEnabled })；保留天数行内保存 payload
6. 日志级别 Select 变更触发 updateSystemLogConfig({ level })（mock API 断言）
7. 立即清理（任务追踪）调用 cleanupTaskTraces（mock API 断言）
8. 加载骨架渲染

### 验证

- `npx vitest run src/components/settings/__tests__/data-maintenance-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 8 — 模型管理页（ModelsPage，能力+访问控制分区）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/models/ModelsPage.tsx`（页壳 + 分区，薄）
- 新建 `packages/frontend/src/components/settings/__tests__/models-page.test.tsx`
- 不触碰其他文件（旧页 Task 13 处理）

### 背景

- `features/settings/pages/system-models/SystemModelsPage.tsx`（模型目录与能力：表格/能力开关/上下文窗口/温度/导入导出/批量重置/搜索/排序/分页）与 `components/settings/pages/SystemModelAccess.tsx`（默认访问策略卡 + 模型访问覆写列表）**共用同一 `useSystemModels` hook**（`components/settings/system-models/use-system-models.tsx`，store 支撑，模型列表数据天然单一来源）；两页当前在注册表中叠挂（stacked）
- 本任务做「同页分区」：新页壳 = 页头 + 上分区（模型目录与能力，内嵌 `<SystemModelsPage />`）+ 分隔 + 下分区（访问控制，内嵌 `<SystemModelAccessPage />`）；两组件原样整组件内嵌（零改动），hook 各自实例化（store 数据共享，UI 局部状态独立——与当前叠挂行为一致）

### 新页结构

```
ModelsPage
├─ 页头：标题「模型管理」+ 白话副标题（如 "管理模型目录、能力开关与访问控制"）
├─ 分区一：标题「模型目录与能力」（h2 + 图标 Cpu + 一句白话说明）
│    <SystemModelsPage />（原样内嵌）
├─ 分隔（border-t + 留白）
└─ 分区二：标题「访问控制」（h2 + 图标 Shield + 一句白话说明）
     <SystemModelAccessPage />（原样内嵌）
```

### 实现要点

1. 页壳无需 useSystemSettings（子组件自带）；无骨架/错误层（子组件自管）——页壳只做组合
2. 分区标题样式参照既有 h2 模式（如 SystemUsers 的 v2-panel 内 h2 + icon）
3. 不修改两个内嵌组件；不引入新依赖

### 测试（TDD，先红后绿）

`models-page.test.tsx`（mock：`@/components/settings/system-models/use-system-models`（复现 fixtures 的 mockSystemModels 形态）、`@/hooks/use-system-settings`、`@/store/auth-store`（admin）、useToast；渲染 `<ModelsPage />`）：
1. 渲染页头标题「模型管理」与两个分区标题「模型目录与能力」「访问控制」
2. 上分区渲染模型表格（fixtures sampleModelList 行可见，如模型名）
3. 下分区渲染默认访问策略（「默认访问策略」标题可见）与覆写列表（模型行可见）
4. modelsLoading 时渲染加载骨架（不崩溃）

### 验证

- `npx vitest run src/components/settings/__tests__/models-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 9 — 用户与注册页（UsersRegistrationPage，注册策略卡 + 用户管理）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/users-registration/UsersRegistrationPage.tsx`（页壳，薄）+ 同目录注册卡组件（≤700 行）
- 新建 `packages/frontend/src/components/settings/__tests__/users-registration-page.test.tsx`
- 不触碰其他文件（旧页 Task 13 处理）

### 源区块（区块地图行号）

- **注册策略**：`features/settings/pages/system-general/SystemGeneralPage.tsx` 用户注册区块 364-450：开放用户注册 switch 374-389（+「推荐」Badge）→ allowRegistration；匿名访客每日额度 391-430（input id=anonymousDailyQuota + 同步按钮 + AlertDialog 同步确认 406-428，确认后 `syncAnonymousQuota({ resetUsed: true })`）→ anonymousDailyQuota；注册用户默认每日额度 432-448 → defaultUserDailyQuota；draft/校验/fieldChanged 模式 202-333（配额 ≥0 整数；非法 toast「输入无效」）
- **用户管理**：`components/settings/pages/SystemUsers.tsx`（165 行，整组件内嵌：搜索面板/批量操作/用户表格分页/额度/审批/确认对话框；`useSystemUsers` hook：`components/settings/system-users/use-system-users.tsx`）

### 新页结构

```
UsersRegistrationPage
├─ 页头：标题「用户与注册」+ 白话副标题（如 "注册开放策略、每日额度与用户管理"）
├─ ① 注册策略 FeatureCard（icon UserPlus，标题「用户注册」，desc「控制新用户的注册和访客访问」）
│    内容区 3 行：开放用户注册 Switch（+推荐 Badge）→ allowRegistration
│          匿名访客每日额度 Input（+同步按钮 + AlertDialog 确认）→ anonymousDailyQuota
│          注册用户默认每日额度 Input → defaultUserDailyQuota
│    footer：保存按钮「保存注册策略」（dirty 跟踪 + ≥0 整数校验；payload 3 key；同步按钮独立于保存，确认即调 syncAnonymousQuota）
├─ 分区二：标题「用户管理」（h2 + 图标 Users + 一句白话说明）
│    <SystemUsersPage />（原样内嵌，整组件；页壳不提供其状态）
└─ 无 Dialog（同步 AlertDialog 在注册卡内；用户相关对话框随 SystemUsersPage）
```

### 实现要点

1. 页壳单 useSystemSettings（注册卡用）+ 共享 loading 骨架/错误重试（仿 search-knowledge 页壳）；用户管理区由 SystemUsersPage 自管
2. 注册卡沿用源 draft/校验/fieldChanged/toast（「输入无效」）；同步按钮行为与 AlertDialog 原样（syncAnonymousQuota 从 `@/features/settings/api` 导入）
3. 行 JSX 沿用源；不引入新依赖；无未使用 props

### 测试（TDD，先红后绿）

`users-registration-page.test.tsx`（mock：useSystemSettings/useToast/@/features/settings/api（syncAnonymousQuota）/@/components/settings/system-users/use-system-users（返回 1-2 行用户数据）/auth-store；baseSettings 已有 allowRegistration/anonymousDailyQuota/defaultUserDailyQuota）：
1. 渲染页头 + 「用户注册」卡 + 「用户管理」分区标题
2. 注册卡保存 payload 3 key 精确断言
3. anonymousDailyQuota=-1 阻断 + toast「输入无效」
4. 同步按钮打开确认对话框，确认后调用 syncAnonymousQuota（mock 断言 { resetUsed: true }）
5. 用户管理区渲染用户行（mock 数据行可见）
6. settings loading 时渲染骨架不崩溃

### 验证

- `npx vitest run src/components/settings/__tests__/users-registration-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 10 — 品牌与界面页（BrandingPage，AI 头像 + 品牌定制）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/branding/BrandingPage.tsx`（页壳，薄）+ 同目录卡组件（≤700 行）
- 新建 `packages/frontend/src/components/settings/__tests__/branding-page.test.tsx`
- 不触碰其他文件（SystemGeneralPage Task 13 删除）

### 源区块（区块地图行号）

- `features/settings/pages/system-general/SystemGeneralPage.tsx`：
  - **AI 头像** 338-362：`AvatarUploadField`（来自 `components/settings/components/avatar-upload-field.tsx`，props 需读源确认，含 preview/saving/onUpload/onClear 之类）绑定 `assistantAvatarPreview`/`assistantAvatarSaving` + `handleAssistantAvatarUpload`（168：`{ data, mime }` 立即保存）/`handleAssistantAvatarClear`（188：`assistantAvatarRemove: true` 立即保存）
  - **品牌定制拆分**：文字 LOGO 533-551（input id=brandText maxLength 40 + IME 处理）→ brandText；全局系统提示词 553-570（Textarea）→ chatSystemPrompt；图片访问域名 627-661（input id=chatImageDomain 写入 siteBaseUrl + 刷新按钮 → refreshImageAttachments，来自 `@/features/settings/api`）
  - draft/fieldChanged 模式 202-250；handleSaveGeneral 中 siteBaseUrl trimmed（307-328）
  - 注意：`isAdmin`（49-53）在源中用于同步按钮等——本页不含同步按钮，如 avatar 区无管理员门禁则不需 isAdmin（以源为准，仅当某控件依赖才保留）

### 新页结构

```
BrandingPage
├─ 页头：标题「品牌与界面」+ 白话副标题（如 "AI 头像、品牌标识与站点信息"）
├─ ① AI 头像 FeatureCard（icon Palette，标题「AI 头像」，desc「设置全局生效的 AI 回复头像」；无主开关无 footer——上传/清除即存）
│    内容区：<AvatarUploadField />（源 351-360 原样搬移，绑定本页状态与 handler）
├─ ② 品牌定制 FeatureCard（icon Type，标题「品牌定制」，desc「自定义系统的品牌标识和外观」）
│    内容区 3 行：文字 LOGO（+IME 处理）→ brandText
│          全局系统提示词（Textarea）→ chatSystemPrompt
│          图片访问域名（+刷新按钮）→ siteBaseUrl（trim 后保存）
│    footer：保存按钮「保存品牌设置」（dirty 跟踪；payload 3 key；siteBaseUrl trim；brandText maxLength 40 输入端约束）
```

### 实现要点

1. 页壳单 useSystemSettings + 共享骨架/错误重试（仿 search-knowledge 页壳）
2. 头像立即保存语义：上传 → `update({ assistantAvatarUpload: { data, mime } })`；清除 → `update({ assistantAvatarRemove: true })`；toast 沿用源
3. 品牌卡沿用源 draft/fieldChanged（siteBaseUrl trim 比较）；刷新按钮调 refreshImageAttachments
4. 行 JSX 沿用源；不引入新依赖；无未使用 props

### 测试（TDD，先红后绿）

`branding-page.test.tsx`（mock：useSystemSettings/useToast/@/features/settings/api（refreshImageAttachments）；`AvatarUploadField` 用 vi.mock 替换为桩组件（渲染「上传」「清除」两个按钮分别触发 props 的 onUpload/onClear）——避免 jsdom 文件输入难点）：
1. 渲染页头 + 两卡标题（AI 头像/品牌定制）
2. 品牌卡保存 payload 3 key 精确断言（siteBaseUrl 被 trim）
3. dirty：修改后保存启用；还原原值后 disabled
4. 点击「上传」→ update 被调 with `{ assistantAvatarUpload: { data, mime } }`（桩传入固定值）
5. 点击「清除」→ update 被调 with `{ assistantAvatarRemove: true }`
6. 刷新按钮 → refreshImageAttachments 被调（mock 断言）
7. settings loading 骨架渲染

### 验证

- `npx vitest run src/components/settings/__tests__/branding-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 11 — Skill 治理页（SkillsGovernancePage，3 section，安装已移出）

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/pages/skills-governance/SkillsGovernancePage.tsx`（≤700 行；必要时同目录拆子组件）
- 新建 `packages/frontend/src/components/settings/__tests__/skills-governance-page.test.tsx`
- 不触碰其他文件（SystemSkills.tsx Task 13 删除；SkillInstallSection 已被 Task 5 迁至工具与扩展页）

### 源文件（区块地图行号）

- `pages/SystemSkills.tsx`（680 行）：安装 section 551-560 **不进入本页**（T-5 已迁出）；保留：待审批调用 562-567（SkillApprovalsSection）、Skill 版本管理 569-577（SkillVersionSection）、绑定策略 579-600（SkillBindingsSection）、卸载预览 Dialog 602-675（由版本管理触发）
- state 222-245（去掉 installSource/installToken/installing/refreshing）；`refreshAll` 252-294（listSkillCatalog({all:true,includeVersions:true}) + listSkillBindings() + listSkillApprovals({status:'pending',limit:100})，Promise.all）
- handlers：approveSkillVersion(341)/activateSkillVersion(362)/previewSkillUninstall(387)/deleteSkill(432)/upsertSkillBinding(478-486)/deleteSkillBinding(505)/respondSkillApproval(523)；`selectedSkill` memo(247-250)
- 模块内辅助：`ensureStringList`(52-57)、`ensureActiveDependencySources`(59-126)、`PackageBucket`(128-156)、`ActiveSkillSourcesBucket`(158-218) 随迁
- 子组件（受控）：`pages/system-skills/SkillApprovalsSection.tsx` / `SkillVersionSection.tsx` / `SkillBindingsSection.tsx` 直接复用

### 新页结构

```
SkillsGovernancePage
├─ 页头：标题「Skill 治理」+ 白话副标题（如 "审批调用、版本管理与绑定策略"）
├─ ① 待审批调用 section（<SkillApprovalsSection />，props 原样）
├─ ② Skill 版本管理 section（<SkillVersionSection />，props 原样，含卸载触发）
├─ ③ 绑定策略 section（<SkillBindingsSection />，props 原样）
└─ 卸载预览 Dialog（602-675 原样，确认后 deleteSkill）
```

### 实现要点

1. 从 SystemSkills.tsx 原样迁移（去掉安装相关 state/handler/JSX；loading 语义保留：`loading` 用于三 section 初始加载，`refreshing` 已随安装移除——版本/审批区原有自己的 action key 状态）
2. 页壳自带全部状态（无 useSystemSettings——本页无 settings key）；无共享骨架层（源行为：整页 loading 骨架，保留）
3. 安装 section 必须完全不在本页（「Skill 安装」标题与 installSource/installToken/installing/refreshing 状态不得出现）
4. 不引入新依赖；无未使用 props/state

### 测试（TDD，先红后绿）

`skills-governance-page.test.tsx`（mock：`@/features/skills/api` 全部 10 函数（listSkillCatalog/listSkillBindings/listSkillApprovals/respondSkillApproval/approveSkillVersion/activateSkillVersion/upsertSkillBinding/deleteSkillBinding/previewSkillUninstall/deleteSkill）+ useToast；fixtures 内联构造 catalog/bindings/approvals 最小数据）：
1. 渲染页头 + 3 section 标题（待审批调用/Skill 版本管理/绑定策略）
2. 「Skill 安装」标题不可见（queryByText null）
3. 待审批行点「批准」→ respondSkillApproval(requestId, {approved:true})（mock 断言）
4. 版本行点「激活并设默认」→ activateSkillVersion(skillId, versionId, {makeDefault:true})（mock 断言）
5. 绑定表单保存 → upsertSkillBinding（payload 断言）
6. 卸载：点「卸载 Skill」→ 预览 Dialog 出现（mock previewSkillUninstall）→ 确认删除 → deleteSkill(skillId)
7. loading 时骨架渲染

### 验证

- `npx vitest run src/components/settings/__tests__/skills-governance-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿
- `npx tsc --noEmit`；`npx next lint` 新文件无 error

## Task 12 — 日志与审计页：泛化 tab 容器（SettingsTabs）+ SystemSkillAuditsPage 重构

文件（仅这些）：
- 新建 `packages/frontend/src/components/settings/components/settings-tabs.tsx`（配置驱动 tab 容器，≤300 行）
- 修改 `packages/frontend/src/components/settings/pages/SystemSkillAudits.tsx`（仅重构为使用容器，行为/文案零变化）
- 新建 `packages/frontend/src/components/settings/__tests__/settings-tabs.test.tsx`
- 新建 `packages/frontend/src/components/settings/__tests__/system-skill-audits-page.test.tsx`（轻量冒烟）
- 不触碰其他文件（LogViewerPage 不在范围——独立路由，样式不同，本次不动）

### 源现状（区块地图行号）

- `pages/SystemSkillAudits.tsx`（417）：`AUDIT_TABS`(52-71) = skill-audit「Skill 审计」ShieldCheck / task-trace「任务追踪」FileText / system-logs「运行日志」TerminalSquare（各带 description）；容器实现 161-194（v2-panel 头：图标瓦片 + `{activeTabDef.label}日志` 标题 + description；tab 按钮 pill 样式 172-193）；内容切换 196-412（skill-audit 内联 196-408 / `<TaskTraceConsole/>` 410 / `<SystemLogsPage/>` 412）；状态 activeTab(74)；辅助 `parseInputInt`(34-38)/`normalizePayload`(40-48)/`APPROVAL_OPTIONS`(19-25)/`STATUS_BADGE_VARIANT`(27-32)

### 新容器规格

```tsx
// components/settings/components/settings-tabs.tsx
export type SettingsTabDef = { key: string; label: string; icon: LucideIcon; description: string }

export function SettingsTabs({
  tabs,              // SettingsTabDef[]
  defaultTab,        // 初始激活 key
  titleOf,           // 可选 (tab) => string，默认取 label（SystemSkillAudits 传 (t) => `${t.label}日志` 保持文案不变）
  renderContent,     // (activeKey: string) => ReactNode
}: SettingsTabsProps)
```

渲染（从 SystemSkillAudits 161-194 原样提取）：
1. v2-panel 头部：图标瓦片（当前 tab）+ titleOf(activeTab) + description
2. tab 按钮行：pill 样式逐字沿用 172-193（active: `border-primary bg-primary text-primary-foreground shadow-[...]`）
3. 内容区：`renderContent(activeTab)`；内部 useState(defaultTab)
4. tab 按钮 `type="button"` + `aria-pressed` 或 aria-selected（原实现无——补上可访问性，低成本）

### SystemSkillAuditsPage 重构要点

- 删除本地 activeTab state 与 161-194 容器 JSX；改用 `<SettingsTabs tabs={AUDIT_TABS} defaultTab="skill-audit" titleOf={(t) => `${t.label}日志`} renderContent={...} />`
- renderContent：'skill-audit' → 原 196-408 内联内容（filter 面板 + 结果表 + 分页，全部原样）；'task-trace' → <TaskTraceConsole/>；'system-logs' → <SystemLogsPage/>
- 其余（state/handlers/audit 查询/辅助函数）零改动；导出名与默认导出保持

### 测试（TDD，先红后绿）

`settings-tabs.test.tsx`：
1. 渲染标题（titleOf 生效）与描述、全部 tab 按钮
2. 默认 tab 内容渲染（renderContent 收到 defaultTab）
3. 点击其他 tab → renderContent 收到新 key、按钮激活态切换（aria 断言）
4. 无 titleOf 时默认取 label

`system-skill-audits-page.test.tsx`（轻量冒烟，mock `@/features/skills/api`（listSkillAudits/listSkillCatalog）+ useToast + `@/features/system/api`）：
1. 渲染 3 个 tab 按钮（Skill 审计/任务追踪/运行日志）
2. 默认显示 skill-audit 内容（查询面板可见）
3. 点击「任务追踪」不崩溃（TaskTraceConsole 挂载；不断言其内部细节）

### 验证

- `npx vitest run src/components/settings/__tests__/settings-tabs.test.tsx src/components/settings/__tests__/system-skill-audits-page.test.tsx` 全绿
- `npx vitest run src/components/settings` 全绿（含既有 settings-shell 等）
- `npx tsc --noEmit`；`npx next lint` 涉及文件无 error

## Task 13 — 注册表重映射 + 旧页清理 + 测试修复 + 遗留收口（PR-2 最后一步）

文件范围：注册表、被删旧页、受影响测试、两处遗留收口（见下）。这是阶段 2 收尾任务，允许触碰此前被禁止的文件。

### A. 注册表重映射（`components/settings/system-settings-registry.tsx`）

1. 删除 `stacked()` 辅助与「阶段 1 临时」注释（不再有叠挂）
2. `leafComponentMap` 重映射（动态 import 同步替换）：
   - `search-knowledge` → `pages/search-knowledge/SearchKnowledgePage`（SearchKnowledgePage）
   - `tools-extensions` → `pages/tools-extensions/ToolsExtensionsPage`
   - `reasoning-network` → `pages/reasoning-network/ReasoningNetworkPage`
   - `data-maintenance` → `pages/data-maintenance/DataMaintenancePage`
   - `models` → `pages/models/ModelsPage`
   - `users-registration` → `pages/users-registration/UsersRegistrationPage`
   - `branding` → `pages/branding/BrandingPage`
   - `skills-governance` → `pages/skills-governance/SkillsGovernancePage`
   - `logs-audit` → 保持 `SystemSkillAuditsPage`（已重构）
   - `overview`/`connections`/`mcp` 不变
3. 移除对被删页面的动态 import：SystemWebSearchPage/SystemRAGPage/SystemKnowledgeBasePage/SystemPythonRuntimePage/SystemNetworkPage/SystemReasoningPage/SystemMonitoringPage/SystemGeneralPage/SystemSkillsPage

### B. 删除旧页面文件（已被新页吸收，确认无其他引用后删）

- `pages/SystemWebSearch.tsx`、`pages/SystemRAG.tsx`、`pages/SystemKnowledgeBase.tsx`（→ search-knowledge）
- `pages/SystemPythonRuntime.tsx`（→ tools-extensions runtime 卡）
- `pages/SystemNetwork.tsx`、`pages/SystemReasoning.tsx`（→ reasoning-network）
- `pages/SystemMonitoring.tsx`（→ data-maintenance）
- `pages/SystemSkills.tsx`（→ skills-governance + tools-extensions 安装卡）
- `features/settings/pages/system-general/SystemGeneralPage.tsx` + `features/settings/pages/system-general/index.ts`（→ branding/users-registration/tools-extensions/data-maintenance 四页）
- **保留**：SystemModelsPage、SystemModelAccess.tsx、SystemUsers.tsx、SystemSkillAudits.tsx、SystemLogsPage.tsx、TaskTraceConsole、SystemConnectionsPage、SystemMcpPage、SystemOverviewContent（均仍被引用）
- 删除前 `grep -rn` 全 frontend/src 确认零引用（registry/测试已在本任务内同步改）

### C. 测试修复

1. `__tests__/system-settings-pages.test.tsx`：删除针对被删页面的测试与 import——SystemGeneralPage 3 测试 + 快照、SystemNetworkPage 测试、SystemReasoningPage 测试、SystemWebSearchPage 测试；保留非管理员重定向测试与 SystemModelsPage 快照测试（页面仍存在）。其行为覆盖已由新页测试承接（branding 3key/users-registration 3key/tools-extensions battle+title/data-maintenance retention+compression/reasoning-network 21key/search-knowledge websearch payload）
2. `__tests__/__snapshots__/system-settings-pages.test.tsx.snap`：**手工剪除** SystemGeneralPage 快照块（不得用 `-u` 全量重写掩盖意外变化）；SystemModelsPage 快照块保留
3. `__tests__/system-python-runtime-page.test.tsx`：改为指向 `pages/tools-extensions/python-runtime-card.tsx`（同名导出？以实际导出为准——先展开卡内「更多参数」/折叠区再交互，5 个用例语义保留：状态显示/来源筛选/索引保存载荷/安装卸载 reconcile 调用/未就绪禁用）
4. `system-settings-registry.test.tsx`：无需大改（12 key 非空断言自然通过新映射）；如旧断言引用被删页面则同步

### D. 遗留收口（此前评审记录的 Minor 落地点）

1. **SkillInstallSection 单消费者收口**：`pages/system-skills/SkillInstallSection.tsx` 现仅被 tools-extensions 使用（SystemSkills.tsx 已删）。删除：内部「Skill 安装」标题（卡标题已承担）、「刷新数据」按钮 + `refreshing`/`onRefresh` props；同步更新 `pages/tools-extensions/skill-install-card.tsx` 不再传 onRefresh/refreshing
2. **ModelsPage 标题去重**：`features/settings/pages/system-models/SystemModelsPage.tsx` 增加可选 `hideHeader?: boolean`（默认 false；true 时不渲染其自身页头）；`pages/models/ModelsPage.tsx` 传 `hideHeader`。SystemModelsPage 现有快照测试不受影响（默认 false）

### E. 验证（全量）

- `npx vitest run`（frontend 全量）全绿，快照仅按 C 节预期变化
- `npx tsc --noEmit` 无错误
- `npx next lint` 无 error
- `grep -rn` 确认被删页面导出名零残留引用

### 验收（阶段 2 整体）

12 叶子全部指向新页/保留页；旧 9 页删除；全量测试绿；tsc/lint 绿；无回归（所有设置 key 可达——由各新页测试覆盖）
