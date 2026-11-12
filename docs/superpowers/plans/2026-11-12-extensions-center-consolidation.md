# 能力扩展中心（设置页三页合一）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把系统设置里的「工具与扩展」「MCP 管理」「Skill 治理」三个叶子页合并为单页「能力扩展」（11 个系统页），在**不改后端、不改任何功能语义**的前提下精简层级、统一交互语言、补上跨类型总览与跳转闭环。

**Architecture:** 新增单叶子页 `extensions`，页内用左侧「段导航（SectionRail）」分 5 段：总览 / MCP 服务 / Skill / 内置工具 / 对话增强；MCP 与 Skill 段内部再用横向「次级标签（SegmentedTabs）」复用原有自包含区块。三个总开关各归其段（单一控制点），总览只呈现状态与入口。导航、搜索、卡定位、深链全部由 `system-settings-registry` 驱动，`shell/nav/dialog/layout` 零改动。

**Tech Stack:** Next.js 15 App Router、React 18、TypeScript、Tailwind + shadcn 原始组件（无 `ui/tabs` 封装）、vitest + @testing-library/react、lucide-react 0.263。

**Spec:** 本文件 §1「设计决策」即本次改动的设计说明（含信息架构、控制点归属、删除清单与不做项）。

## Global Constraints

- 后端零改动：104 个 KV 设置键、`SYSTEM_SETTINGS_FIELD_MAP`、`/api/skills`、`/api/mcp`、`/api/secret-vault`、`/api/python-runtime` 的路径与载荷全部保持原样。
- 保存语义不变：仍是「每卡 / 每段独立保存」，不做整页原子保存，不引入自动保存。
- 不新增依赖；`@radix-ui/react-tabs` 虽在依赖里但没有 `ui/tabs.tsx` 封装，本次用原生按钮实现标签，不新建 radix 封装。
- 不向后兼容：`tools-extensions` / `mcp` / `skills-governance` 三个 leaf key 与 `tools-extensions:*` / `skills-governance:*` 卡 key 直接删除；旧 localStorage 值走既有「非法 key → 回退 `DEFAULT_SYSTEM_LEAF`」逻辑（`renderSystemLeaf` 返回 null），不写迁移代码。
- 文件规模：新增/重写文件每行数目标 ≤ 300（`pnpm lint:lines` 的 `--max 300`）；`SkillsGovernancePage.tsx`（647 行）在 Task 6 拆成 hook + 段组件后删除。
- 文案中文、UTF-8 无 BOM；沿用 `v2-panel` / `v2-panel-soft` / `v2-table-wrap` / `FeatureCard` / `SettingRow` 既有视觉语言，不新造样式体系。
- 图标须在 lucide-react 0.263 存在（已核验）：`Layers` `LayoutGrid` `Boxes` `Puzzle` `Wrench` `Terminal` `Link2` `Server` `KeyRound` `Cable` `Package` `Swords` `Download`。`Blocks` 不存在，禁用。
- 每个新组件必须在无数据/加载中/错误三态下都可渲染，不允许裸 `any` 扩散。

## Review Focus

- 旧 localStorage 里存着 `mcp` / `skills-governance` / `tools-extensions` 的管理员：打开设置必须落到「概览」，不得白屏、不得停在空内容。
- 搜索命中 MCP 子标签内的卡（如「凭据」「工具」）时：必须先切到 `mcp` 段与对应次级标签，卡才不会定位失败；`SystemLeafWrapper` 的 1.5s 重试窗口是唯一兜底。
- 总览统计需要 skill approvals / mcp connections / python runtime 三路数据，任一接口 401/403/500 时总览必须降级为「未知」而不是整页报错。
- 匿名访客与无权限用户：`SettingsDialog` 会以 `readOnly` 渲染，段的切换与只读展示不得触发写请求。
- 窄屏（≤390px）：左栏段导航折成横向滚动条后，段内次级标签不能同时占满一行导致双重横向滚动。
- 同一 settings key 出现两个控制点（如 `pythonToolEnable` 既在 Python 卡主开关又在总览）：本计划明确禁止，总览只读状态 + 入口。

---

## 1. 设计决策

### 1.1 这三个页面本质上是同一类

| 环节 | MCP | Skill | Python 内置工具 |
|---|---|---|---|
| 来源 / 安装 | `McpInstallation` 模板 | GitHub 安装 → 版本 | 受管 venv（预置） |
| 运行实例 | `McpConnection`（带凭据） | 激活版本（默认版本） | 沙箱进程 |
| 凭据 | `/api/secret-vault`（mcp_credential） | Skill 密钥需求（后端已有） | — |
| 工具 / 能力清单 | Tools 搜索 + 固定 + Schema | 版本能力声明 | Python 执行 |
| 授权 | 绑定 system/user/session | 待审批调用 + 绑定策略 | 开关 + 迭代上限 |
| 总开关 | `mcpGlobalEnabled` | `chatDynamicSkillRuntimeEnabled` | `pythonToolEnable` |

结论：三者是同一条「能力生命周期」的三份实例，应当同页；但**按对象分栏**比按阶段横切更符合管理员「我要修 MCP 连接」的心智，也避免把「MCP 工具搜索」「Python 参数」「Skill 能力」硬塞进同一个「工具」标签。

### 1.2 目标信息架构

```
系统设置（11 叶）
├─ 概览 overview
├─ 模型与连接 ── 供应商与连接 / 模型管理 / 图片转写
├─ 功能与工具 ── 搜索与知识库 / 能力扩展 extensions      ← 三页合一
├─ 用户与注册 users-registration                        ← 原「成员与安全」单子分组拍平
├─ 系统与数据 ── 品牌与界面 / 日志与审计 / 数据与维护
└─ 高级设置   ── 推理与网络
```

`能力扩展` 页内（左栏段导航 + 段内次级标签）：

```
总览        三类能力状态卡（MCP / Skill / 内置工具）+ 待处理清单 + 其他增强入口
MCP 服务    全局开关 ｜ 安装模板 / 连接 / 凭据 / 工具 / 绑定
Skill       运行时开关 + 安装入口 ｜ 安装 / 待审批 / 版本 / 绑定
内置工具    Python 工具卡（主开关 + 超时/输出/源码长度 + 迭代上限）+ 运行时管理卡
对话增强    模型大乱斗 + 标题智能总结
```

### 1.3 关键取舍（写死，执行者不要再改）

1. **不做阶段横切**（不设「已安装 / 连接与凭据 / 工具 / 授权」跨类型标签）。理由：同一标签内动作词不同（模板编辑 vs 版本激活 vs 依赖同步），会造成假统一。
2. **总开关单一控制点**：`mcpGlobalEnabled` 留在 MCP 段页头；`chatDynamicSkillRuntimeEnabled` 从 Python 卡「更多参数」搬到 Skill 段页头（语义纠错，功能不变）；`pythonToolEnable` 留在 Python 卡主开关。总览只显示状态徽标 + 「进入」按钮，不放 Switch。
3. **Skill 安装留在 Skill 段首个次级标签**（不改成 Dialog）：保留 `SkillInstallSection` 原组件与原校验，减少回归面。
4. **MCP 静态「总览」标签删除**（原 6 标签 → 5），其「推荐配置流程」信息并入页面总览的 MCP 状态卡说明。
5. **MCP 表单字段白话化**：`namespaceKey/name/description/sourceType/transport/endpoint` 平铺为中文标签；`command/argsJson/envJson/sourceUrl/sourceKey/registrySource` 收进「高级（原样字段）」折叠，默认收起。字段名、payload、校验一个不改。
6. **「成员与安全」分组拍平**：仅剩「用户与注册」一个子项时保留分组等于多一次点击，直接提升为顶级叶（图标 `Users`）。
7. **卡定位扩展**：`systemSettingsCards` 的卡 key 全部改为 `extensions:*`，并新增 `EXTENSION_CARD_ROUTES` 把卡 key 映射到「段 + 次级标签」，页面在挂载与事件时先切段再交给 `SystemLeafWrapper` 滚动。
8. **不新建「扩展市场」「一键安装」等新功能**；不合并 MCP 绑定与 Skill 绑定的表单（作用域相同但字段与语义不同）。

### 1.4 删除清单

- `components/settings/pages/tools-extensions/ToolsExtensionsPage.tsx`
- `components/settings/pages/skills-governance/SkillsGovernancePage.tsx`
- `components/settings/pages/SystemMcpPage.tsx`（再导出壳）
- `components/settings/system-mcp/SystemMcpPage.tsx`
- `components/settings/system-mcp/overview-tab.tsx`
- `components/settings/system-mcp/tab-bar.tsx`
- `components/settings/pages/tools-extensions/skill-install-card.tsx`（安装区改由 Skill 段直接渲染 `SkillInstallSection`）
- `system-mcp/mcp-ui.tsx` 中的 `McpNavRail` / `MCP_TABS`（被 `SectionRail` + 段配置取代；`McpListHeader/McpEmptyState/McpFormPanel/McpField/McpSelectField/McpInlineWarning` 保留）

---

## 2. 文件影响面

**新建**

- `packages/frontend/src/components/settings/components/section-rail.tsx`
- `packages/frontend/src/components/settings/components/segmented-tabs.tsx`
- `packages/frontend/src/components/settings/pages/extensions/ExtensionsPage.tsx`
- `packages/frontend/src/components/settings/pages/extensions/extensions-sections.ts`
- `packages/frontend/src/components/settings/pages/extensions/sections/overview-section.tsx`
- `packages/frontend/src/components/settings/pages/extensions/sections/mcp-section.tsx`
- `packages/frontend/src/components/settings/pages/extensions/sections/skill-section.tsx`
- `packages/frontend/src/components/settings/pages/extensions/sections/tools-section.tsx`
- `packages/frontend/src/components/settings/pages/extensions/sections/extra-section.tsx`
- `packages/frontend/src/features/skills/use-skills-governance.ts`
- 测试：`__tests__/section-rail.test.tsx`、`__tests__/segmented-tabs.test.tsx`、`__tests__/extensions-page.test.tsx`、`__tests__/extensions-sections.test.tsx`（总览/MCP/Skill/工具/增强）

**修改**

- `system-settings-registry.tsx`（树 11 叶、card 注册表、leafComponentMap、`getWorkspaceForLeaf` 行为）
- `settings-flash-bus.ts`（新增只读 `peekFlash`）
- `system-mcp/installations-tab.tsx`、`connections-tab.tsx`、`secrets-tab.tsx`、`tools-tab.tsx`、`bindings-tab.tsx`（仅标签文案与折叠，逻辑不动）
- `pages/tools-extensions/python-tools-card.tsx`（移除「更多参数」里的动态 Skill Runtime 块，其余不动）
- `pages/system-skills/{SkillApprovalsSection,SkillVersionSection,SkillBindingsSection,SkillInstallSection}.tsx`（若需补 `data-card-key` 或标题，仅样式层）
- 测试：`system-settings-registry.test.tsx`、`system-settings-card-registry.test.tsx`、`system-settings-pages.test.tsx`、`system-settings-pages.fixtures.ts`、`settings-search.test.tsx`、`settings-dialog-search.test.tsx`、`tools-extensions-page.test.tsx` → 改名/重写为 `extensions-sections.test.tsx` 的一部分、`skills-governance-page.test.tsx` → `extensions-skill-section.test.tsx`、`system-mcp/__tests__/tools-tab.test.tsx`（若引用旧 key 则更新）

**不动**：`shell.tsx`、`nav.tsx`、`settings-dialog.tsx`、`settings-layout-client.tsx`、`system-settings.tsx`、`settings-search.tsx`、`system-leaf-wrapper.tsx`、`features/settings/*`、`features/mcp/*`、`features/skills/*`（除新增 hook）、后端全部。

---

## Task 1: 注册表重组（11 叶 + 新卡注册表 + 一致性测试）

**Files:**
- Modify: `packages/frontend/src/components/settings/system-settings-registry.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/system-settings-registry.test.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/system-settings-card-registry.test.tsx`

**Interfaces:**
- Produces: `systemSettingsTree`（6 顶级 = 4 分组 + 2 顶级叶）、`getAllSystemLeafKeys(): string[]`（11 项）、`getWorkspaceForLeaf(key)`（`extensions` → `features-tools`；`users-registration` → `users-registration`）、`systemSettingsCards`（`extensions:*` 13 条）、`renderSystemLeaf(key, hostId)`（`extensions` → `ExtensionsPage`，旧三 key 返回 null）。

- [ ] **Step 1: 写失败测试** —— 重写 `system-settings-registry.test.tsx`

断言：顶级 6 项且首项为 `overview` 叶子；分组 key 依次为 `model-connections`/`features-tools`/`system-data`/`advanced`；`features-tools.children` = `["search-knowledge","extensions"]`；`users-registration` 为顶级叶子（无 children）；`getAllSystemLeafKeys()` 长度 11 且不含 `tools-extensions`/`mcp`/`skills-governance`；`test.each(["tools-extensions","mcp","skills-governance"])` → `renderSystemLeaf(k)===null`；`renderSystemLeaf("extensions")!==null`；`DEFAULT_SYSTEM_LEAF==="overview"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/frontend && npx vitest run src/components/settings/__tests__/system-settings-registry.test.tsx`
Expected: FAIL（`features-tools.children` 仍为 3 项、`renderSystemLeaf("extensions")` 为 null）。

- [ ] **Step 3: 改注册表** —— 按 §1.2 重排树；`extensions` 叶子 `{ key:"extensions", label:"能力扩展", icon: Layers, keywords:["MCP","模型上下文协议","Skill","Python","扩展","工具","审批","绑定","凭据","安装","大乱斗","标题"] }`；`leafComponentMap` 的 `extensions` 指向 `dynamic(() => import("./pages/extensions/ExtensionsPage").then(m => m.ExtensionsPage))`。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2 命令。Expected: PASS。

- [ ] **Step 5: 卡注册表 + 映射一致性测试**

`systemSettingsCards` 中 `leafKey:"extensions"` 的 13 条卡 key：`extensions:mcp-installations|mcp-connections|mcp-secrets|mcp-tools|mcp-bindings|skill-install|skill-approvals|skill-versions|skill-bindings|python-tools|python-runtime|battle|title-summary`。测试断言「每条 extensions 卡都能被 `routeForCard` 解析」——本 Step 先只改注册表侧断言（`routeForCard` 在 Task 3 引入，届时补 import）。

- [ ] **Step 6: 提交**

```bash
git add packages/frontend/src/components/settings/system-settings-registry.tsx packages/frontend/src/components/settings/__tests__/system-settings-registry.test.tsx packages/frontend/src/components/settings/__tests__/system-settings-card-registry.test.tsx
git commit -m "refactor(settings): 系统设置树合并三页为能力扩展，11 叶 + 新卡注册表"
```

---

## Task 2: 通用段导航与次级标签组件

**Files:**
- Create: `packages/frontend/src/components/settings/components/section-rail.tsx`
- Create: `packages/frontend/src/components/settings/components/segmented-tabs.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/section-rail.test.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/segmented-tabs.test.tsx`

**Interfaces:**
- Produces: `SectionRail<K extends string>({ items: SectionRailItem<K>[], active: K, onChange: (k: K) => void, ariaLabel: string })`；`SectionRailItem<K> = { key: K; label: string; shortLabel?: string; icon: LucideIcon; description?: string }`。桌面：`hidden md:flex w-44 shrink-0 flex-col gap-0.5`；移动：`md:hidden overflow-x-auto` 横向按钮。
- Produces: `SegmentedTabs<K extends string>({ items: SegmentedTabItem<K>[], active: K, onChange: (k: K) => void, ariaLabel: string })`；`SegmentedTabItem<K> = { key: K; label: string; icon?: LucideIcon; badge?: string }`。语义：`role="tablist"` + 每项 `role="tab"` `aria-selected`，容器 `flex flex-wrap gap-1`（窄屏换行，不产生第二条横向滚动）。

- [ ] **Step 1: 写失败测试** —— `section-rail.test.tsx`：渲染 3 项、`active` 项带 `aria-current="page"` 与 `data-active`、点击第 2 项 `onChange` 收到其 key；`segmented-tabs.test.tsx`：`role="tablist"` 存在、`aria-selected` 跟随 active、点击回调。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/frontend && npx vitest run src/components/settings/__tests__/section-rail.test.tsx src/components/settings/__tests__/segmented-tabs.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现两组件** —— 样式从 `system-mcp/mcp-ui.tsx` 的 `McpNavRail` 抽取（桌面竖排 + 移动横排），次级标签沿用其移动端 pill 样式；全部按钮带 `focus-visible:ring-2 focus-visible:ring-primary`。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2）。

- [ ] **Step 5: 提交** `git commit -m "feat(settings): 抽出 SectionRail 与 SegmentedTabs 通用段导航"`

---

## Task 3: ExtensionsPage 骨架（段路由 + 卡定位）

**Files:**
- Create: `packages/frontend/src/components/settings/pages/extensions/ExtensionsPage.tsx`
- Create: `packages/frontend/src/components/settings/pages/extensions/extensions-sections.ts`
- Modify: `packages/frontend/src/components/settings/settings-flash-bus.ts`
- Test: `packages/frontend/src/components/settings/__tests__/extensions-page.test.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/settings-flash-bus.test.ts`（补 `peekFlash` 用例）

**Interfaces:**
- Produces: `type ExtensionSection = 'overview'|'mcp'|'skills'|'tools'|'extra'`；`EXTENSION_SECTIONS: ExtensionSectionMeta[]`（label/shortLabel/description/icon）；`EXTENSION_CARD_ROUTES: Record<string, { section: ExtensionSection; segment?: string }>`；`routeForCard(cardKey: string): { section; segment? } | null`；`EXTENSION_SECTION_EVENT = 'aichat:extensions-section'`。
- Produces: `peekFlash(leafKey: string, hostId?: string): FlashRequest | null`（只读，不清空）。
- Consumes: `SectionRail`、`SegmentedTabs`（Task 2）、`SystemLeafWrapper` 的既有 `aichat:settings-flash-card` 事件协议（`{ leafKey, cardKey, hostId }`）。

- [ ] **Step 1: 写失败测试** —— `extensions-page.test.tsx`

用例：①默认渲染总览（`data-section="overview"`）；②点击左栏「MCP 服务」→ `data-section="mcp"`；③`window.dispatchEvent(new CustomEvent('aichat:system-settings-select',{detail:{key:'extensions',section:'skills'}}))` → 切到 `skills`；④`requestFlash({leafKey:'extensions',cardKey:'extensions:mcp-secrets',hostId:'layout'})` 后挂载 → `data-section="mcp"` 且 `data-segment="secrets"`。`settings-flash-bus.test.ts` 补：`peekFlash` 返回请求但不清空，随后 `consumeFlash` 仍能取到。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/frontend && npx vitest run src/components/settings/__tests__/extensions-page.test.tsx src/components/settings/__tests__/settings-flash-bus.test.ts`

- [ ] **Step 3: 实现**

- `settings-flash-bus.ts`：加 `peekFlash`（与 `consumeFlash` 同匹配规则，不清空）。
- `extensions-sections.ts`：段元数据 + 卡路由表（13 条）+ `routeForCard`。图标：`LayoutGrid`(总览) `Link2`(MCP) `Puzzle`(Skill) `Terminal`(内置工具) `Swords`(对话增强)。
- `ExtensionsPage.tsx`：`useState<ExtensionSection>('overview')`；挂载时 `peekFlash('extensions', hostId)` 取 cardKey → `routeForCard` → 设段与次级标签；监听 `aichat:settings-flash-card` 覆盖同一逻辑；监听 `aichat:system-settings-select` 中 `detail.section`。页头：`h1`「能力扩展」+ 一句说明 + 「新增」下拉（MCP 服务模板 / GitHub Skill），下拉项 `dispatchEvent(EXTENSION_SECTION_EVENT, {section, segment})`。宿主 `hostId` 通过 props 传入（`renderSystemLeaf` 已传 `hostId` → 由 `ExtensionsPage` 接收再向下传）。
  > 注：`leafComponentMap` 是 `ComponentType` 无 props；Task 1 的挂载需改为 `renderSystemLeaf` 内对 `extensions` 显式传 `hostId`，或让 `ExtensionsPage` 通过 `useSearchParams`/`window` 判断宿主。**取前者**：`renderSystemLeaf` 对 `extensions` 使用 `<ExtensionsPage hostId={hostId} />`，其余叶子保持 `<Component />`。
- 各段内容先用占位 `<div data-section=...>`，Task 4–6 填实。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2）。

- [ ] **Step 5: 提交** `git commit -m "feat(settings): 能力扩展页骨架与段/卡定位路由"`

---

## Task 4: 总览段（跨类型状态 + 待处理）

**Files:**
- Create: `packages/frontend/src/components/settings/pages/extensions/sections/overview-section.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/extensions-sections.test.tsx`（先建文件，只含总览用例）

**Interfaces:**
- Consumes: `useSystemSettings()`（`settings.mcpGlobalEnabled`/`chatDynamicSkillRuntimeEnabled`/`pythonToolEnable`）、`listSkillApprovals({status:'pending',limit:100})`、`listConnections()`、`getRuntimeStatus()`（按 `python-runtime-card.tsx` 现有 API 导入路径取用）。
- Produces: `OverviewSection({ onNavigate }: { onNavigate: (section: ExtensionSection, segment?: string) => void })`。

- [ ] **Step 1: 写失败测试**：三类卡渲染出「MCP 服务 / Skill / 内置工具」+ 状态徽标（开启/关闭）；待审批数量来自 mock 的 3 条 → 文案「3 条待审批」；点击「进入」调用 `onNavigate('mcp')`；`listSkillApprovals` reject 时该卡显示「状态未知」且页面不抛错。
- [ ] **Step 2: 跑测试确认失败**（`npx vitest run src/components/settings/__tests__/extensions-sections.test.tsx`）。
- [ ] **Step 3: 实现** —— 3 张 `v2-panel` 状态卡（图标 + 名称 + 状态徽标 + 一句话 + 「进入」）+「待处理」列表（待审批 / 未配置凭据的连接数 / 未激活版本数，任一未知显示「—」）+ 底部「其他增强」两个入口。**不放 Switch**。`Promise.allSettled` 并发取数。
- [ ] **Step 4: 跑测试确认通过**；**Step 5: 提交**。

---

## Task 5: MCP 段（6 标签 → 5 标签 + 表单白话化）

**Files:**
- Create: `packages/frontend/src/components/settings/pages/extensions/sections/mcp-section.tsx`
- Modify: `system-mcp/installations-tab.tsx`（标签白話 + 高级折叠）、`connections-tab.tsx`/`secrets-tab.tsx`/`bindings-tab.tsx`（标签白話）
- Delete: `system-mcp/SystemMcpPage.tsx`、`system-mcp/overview-tab.tsx`、`system-mcp/tab-bar.tsx`、`pages/SystemMcpPage.tsx`、`mcp-ui.tsx` 的 `MCP_TABS`/`McpNavRail`
- Test: `extensions-sections.test.tsx`（补 MCP 用例）、`system-mcp/__tests__/tools-tab.test.tsx`

**Interfaces:**
- Produces: `McpSection({ hostId }: { hostId?: string })`；内部 `MCP_SEGMENTS = ['installations','connections','secrets','tools','bindings'] as const`，每段内容外包 `<div data-card-key={`extensions:mcp-${seg}`}>`。
- 全局开关：沿用 `getSystemSettings/updateSystemSettings`，写 `mcpGlobalEnabled`，位置在段页头右侧（与原 MCP 页头一致），关闭时在非「安装模板」段显示一行提示。

- [ ] **Step 1: 写失败测试**：分段标签 5 项且不含「总览」；点击「凭据」渲染 `SecretsTab`（mock）；`mcpGlobalEnabled` 为 false 时切「连接」出现全局关闭提示；开关切换调用一次 `updateSystemSettings({mcpGlobalEnabled:false})`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现** —— `McpSection` 用 `SegmentedTabs` 组织 5 个既有 tab；`installations-tab.tsx` 表单改中文标签（namespaceKey→「标识（namespaceKey）」、name→「名称」、description→「描述」、sourceType→「来源类型」、transport→「传输方式」、endpoint→「服务端点」），`command/argsJson/envJson/sourceUrl/sourceKey/registrySource` 收进 `<details>`「高级（原样字段）」；不新增字段、不改 payload。
- [ ] **Step 4: 跑测试确认通过**；**Step 5: 删除 §1.4 中 MCP 相关死代码并跑 `npx tsc --noEmit`**；**Step 6: 提交**。

---

## Task 6: Skill 段（抽 hook + 安装/待审批/版本/绑定 4 标签）

**Files:**
- Create: `packages/frontend/src/features/skills/use-skills-governance.ts`
- Create: `packages/frontend/src/components/settings/pages/extensions/sections/skill-section.tsx`
- Delete: `pages/skills-governance/SkillsGovernancePage.tsx`、`pages/tools-extensions/skill-install-card.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/extensions-skill-section.test.tsx`（由 `skills-governance-page.test.tsx` 迁移改写）

**Interfaces:**
- Produces: `useSkillsGovernance(): { loading, catalog, bindings, approvals, versionActionKey, skillActionKey, approvalActionId, bindingSubmitting, binding: {...drafts}, uninstall: { preview, dialogOpen }, actions: { approveVersion, activateVersion, requestUninstall, confirmUninstall, upsertBinding, deleteBinding, respondApproval, refreshAll, setBinding* } }`——状态与动作整体从现页面搬迁，**行为零改动**（含 `ensureStringList`/`ensureActiveDependencySources` 归一化与卸载预览 Dialog props）。
- Produces: `SkillSection({ hostId })`；次级标签 `['install','approvals','versions','bindings']`，每段 `data-card-key="extensions:skill-*"`；页头右侧：`chatDynamicSkillRuntimeEnabled` 开关（写 settings 键）+ 待审批数量徽标。
- 卸载预览 Dialog 从 `SkillsGovernancePage` 迁到 `SkillSection`（保持文案与按钮禁用态）。

- [ ] **Step 1: 写失败测试**：4 个次级标签；`listSkillCatalog` mock 两版本时「版本」段渲染「批准版本」与「激活并设默认」；点「卸载 Skill」先用 `previewSkillUninstall` 结果打开 Dialog，确认后调 `deleteSkill` 且 toast 文案含「已自动回收 N 个 Python 包」；「绑定」段保存调用 `upsertSkillBinding` 一次；顶部开关写 `{chatDynamicSkillRuntimeEnabled:true}`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现 hook（逐行搬迁，不改逻辑）+ SkillSection**。
- [ ] **Step 4: 跑测试确认通过**；**Step 5: 删旧页与旧安装卡，`npx tsc --noEmit`**；**Step 6: 提交**。

---

## Task 7: 内置工具段 + 对话增强段 + 收口

**Files:**
- Create: `sections/tools-section.tsx`、`sections/extra-section.tsx`
- Modify: `pages/tools-extensions/python-tools-card.tsx`（删除「更多参数」中的 `chatDynamicSkillRuntimeEnabled` 块，其余保留）
- Test: `extensions-sections.test.tsx`（补两段用例）、`system-settings-pages.test.tsx`、`settings-search.test.tsx`、`settings-dialog-search.test.tsx`

- [ ] **Step 1: 写失败测试**：内置工具段渲染 Python 卡主开关与「Python 运行时管理」卡（卡 key 分别 `extensions:python-tools`/`extensions:python-runtime`），且**不再**包含动态 Skill Runtime 开关；对话增强段渲染 `Swords`/`TitleSummary` 两卡；搜索输入「凭据」返回卡结果且 `detail.key==='extensions'`、`detail.cardKey==='extensions:mcp-secrets'`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现两段 + 迁移开关**（`chatDynamicSkillRuntimeEnabled` 只由 Skill 段页头控制）。
- [ ] **Step 4: 全量前端单测**

Run: `cd packages/frontend && npx vitest run`
Expected: 全绿（含被改写的 settings 相关 12 个测试文件）。

- [ ] **Step 5: 类型与规模检查**

Run: `cd packages/frontend && npx tsc --noEmit`；`cd ../.. && pnpm lint:lines`
Expected: 无类型错误；新增文件 ≤300 行。

- [ ] **Step 6: 真实浏览器截图验收**（按 `engineering-and-ui.mdc`）

启动：`cd packages/backend && ...`（按 `README.md` / `start.bat` 的既有方式，数据库为项目内 SQLite），前端 `cd packages/frontend && npx next dev -p 3000`；管理员账号从仓库根 `.env` 读取（不打印密钥）。用会话内浏览器/playwright 打开 `http://127.0.0.1:3000/main/settings/system`，截图存入 `.scratch/screenshots/2026-11-12-extensions/`：

1. 段导航默认态（总览）
2. MCP 服务 5 个次级标签各 1 张
3. Skill 4 个次级标签各 1 张（含卸载预览 Dialog）
4. 内置工具、对话增强各 1 张
5. 搜索「凭据」→ 点击结果 → 位置提示条 + 卡闪烁
6. 1440px 与 390px 两个宽度
7. 控制台无报错、无 4xx/5xx 资源

逐项核对排版/间距/对齐/层级/焦点可见/对比度后，把结论与未覆盖项写入交付说明。

- [ ] **Step 7: 文档同步** —— `CONTEXT.md` §设置（Settings Page 由 13 页改为 11 页、新增「能力扩展」条目与三个总开关归属）、`packages/frontend/src/features/settings/README.md`（导航分组与页面清单）；如与 ADR-0010（MCP 全局门控）表述冲突则以「控制点位置」补充说明，不改语义。
- [ ] **Step 8: 提交** `git commit -m "refactor(settings): 三页合一为能力扩展页，统一段导航与卡定位"`

---

## 验收清单

- [ ] 系统设置只剩 11 个叶子页，导航「功能与工具」下为「搜索与知识库 / 能力扩展」，无「成员与安全」空壳分组
- [ ] 「能力扩展」页 5 段可切换，桌面左栏竖排、移动端横排；MCP 5 段、Skill 4 段次级标签可切换
- [ ] 三个总开关各自唯一控制点；总览只读状态
- [ ] MCP 模板表单字段与 payload 与改前完全一致，仅标签文案与折叠位置变化
- [ ] Skill 安装/审批/版本/卸载/绑定全部可用，toast 与禁用态与改前一致
- [ ] 搜索能定位到 MCP/Skill 段内卡片，旧 key 无残留、无白屏
- [ ] `npx vitest run` 全绿、`tsc --noEmit` 无错、`pnpm lint:lines` 达标
- [ ] 截图证据齐备（1440/390、5 段、关键状态），控制台无报错
