# 设置精简浏览器验收（真实 dev + 隔离后端）

- 验收日期：2026-11-16
- 环境：前端 `http://127.0.0.1:13000`（Next dev）、后端 `http://127.0.0.1:13001`（隔离库 `output/settings-verification/review.db`，无生产数据）。验收中途后端曾短暂无响应、前端 `.next` 缓存曾需重建，恢复后补齐最后两张截图，过程见「验收期间的环境故障与补齐」。
- 会话：Playwright CLI 命名会话 `settings-review`；账号 `settings-review`（ADMIN，本次隔离库新建）
- 视口：宽屏 1440×900、移动 390×844
- 原始截图（全量，含未入选本目录的过程图）：`output/settings-verification/`

## 覆盖矩阵

11 个系统设置叶子 + 个人偏好，宽屏与 390 各一遍。每页判定项：页头正确、无横向溢出（内容区 `scrollWidth - clientWidth = 0`）、**正常态** console 无 error/pageerror。

**console 口径**：下面「正常态」页均为 0 console error、0 pageerror；「错误态 / 保存失败」两行是**故意注入** HTTP 500/400，浏览器必然记录失败请求（Next dev 还会出现 “1 Issue” 浮标），那是故障注入的预期结果，不计为页面缺陷。

| 叶子（key） | 宽屏 | 390 | 页面标题（实测） | 结论 |
| --- | --- | --- | --- | --- |
| 概览 (`overview`) | [wide-overview.png](screenshots/wide-overview.png) | [mobile-overview.png](screenshots/mobile-overview.png) | 概览 | 通过 |
| 供应商与连接 (`connections`) | [wide-connections.png](screenshots/wide-connections.png) | [mobile-connections.png](screenshots/mobile-connections.png) | 供应商与连接 | 通过 |
| 模型管理 (`models`) | [wide-models.png](screenshots/wide-models.png) | [mobile-models.png](screenshots/mobile-models.png) | 模型管理（模型列表 0 条为真实空态） | 通过（空态） |
| 会话默认配置 (`session-defaults`) | [leaf-session-defaults-final.png](screenshots/leaf-session-defaults-final.png)、[leaf-session-defaults-wide.png](screenshots/leaf-session-defaults-wide.png)、[leaf-session-defaults-long.png](screenshots/leaf-session-defaults-long.png) | [mobile-session-defaults.png](screenshots/mobile-session-defaults.png) | 会话默认配置 | 通过 |
| 搜索与知识库 (`search-knowledge`) | [wide-search-knowledge.png](screenshots/wide-search-knowledge.png) | [mobile-search-knowledge.png](screenshots/mobile-search-knowledge.png) | 搜索与知识库 | 通过 |
| 工具与扩展 (`extensions`) | [wide-extensions.png](screenshots/wide-extensions.png) | [mobile-extensions.png](screenshots/mobile-extensions.png) | 工具与扩展 | 通过 |
| 用户与访问 (`users-registration`) | [wide-users-registration.png](screenshots/wide-users-registration.png) | [mobile-users-registration.png](screenshots/mobile-users-registration.png) | 用户与访问 | 通过 |
| 数据与维护 (`data-maintenance`) | [wide-data-maintenance.png](screenshots/wide-data-maintenance.png) | [mobile-data-maintenance.png](screenshots/mobile-data-maintenance.png) | 数据与维护 | 通过 |
| 日志与审计 (`logs-audit`) | [wide-logs-audit.png](screenshots/wide-logs-audit.png) | [mobile-logs-audit.png](screenshots/mobile-logs-audit.png) | Skill 审计日志 | 通过 |
| 生成与网络（高级）(`reasoning-network`) | [wide-reasoning-network.png](screenshots/wide-reasoning-network.png) | [mobile-reasoning-network.png](screenshots/mobile-reasoning-network.png) | 生成与网络 | 通过 |
| 外观与站点 (`branding`) | [wide-branding.png](screenshots/wide-branding.png)、[branding-long-content.png](screenshots/branding-long-content.png) | [mobile-branding.png](screenshots/mobile-branding.png) | 外观与站点 | 通过 |
| 个人偏好（弹窗） | [personal-preferences-wide.png](screenshots/personal-preferences-wide.png) | [personal-preferences-mobile.png](screenshots/personal-preferences-mobile.png) | 个人资料 | 通过 |

导航层级另有：[route-default-wide.png](screenshots/route-default-wide.png)、[route-default-mobile.png](screenshots/route-default-mobile.png)（路由页三级导航：概览 + 6 组）、[nav-group-expanded.png](screenshots/nav-group-expanded.png)（数据与日志展开出「数据与维护 / 日志与审计 / 生成与网络（高级）」）、[mobile-nav-open.png](screenshots/mobile-nav-open.png)（390 目录展开）。

## 关键状态与交互

| 项 | 证据 | 实测结果 |
| --- | --- | --- |
| 加载态 | [state-loading-wide.png](screenshots/state-loading-wide.png) | 拦截 `GET /api/settings/system` 延迟 6s：内容区 12 个骨架块，无假数据；无 console error |
| 错误态（注入 500） | [state-error-wide.png](screenshots/state-error-wide.png) | 拦截返回 500：`role="alert"`「系统设置读取失败 / 模拟：设置读取失败」+「重新加载」；未知项显示「—」而不是猜值；已取到的连接/模型计数仍如实显示 |
| 空态 | [wide-models.png](screenshots/wide-models.png)、[wide-overview.png](screenshots/wide-overview.png) | 模型 0 条、连接 0 条、未开启搜索 → 概览读作「尚未收录模型 / 尚未配置连接 / 未开启」，不带完成率 |
| 键盘焦点 | [focus-keyboard.png](screenshots/focus-keyboard.png) | Tab 走 6 个导航项：全部命中 `:focus-visible`，描边 `solid 1px rgb(15,117,109)` |
| hover / 禁用 | [nav-focus-hover.png](screenshots/nav-focus-hover.png)、[wide-session-defaults.png](screenshots/wide-session-defaults.png) | 叶子 hover 换底色；未改动时保存按钮 `disabled`（reasoning / branding / session-defaults / users 均如此） |
| 长内容 | [branding-long-content.png](screenshots/branding-long-content.png)、[leaf-session-defaults-long.png](screenshots/leaf-session-defaults-long.png) | 品牌名 38 字、站点地址 79 字、提示词 280 字多行：页面无横向溢出，输入控件内部滚动（textarea 232/136） |
| 生成上限自动 | [save-explicit-8192.png](screenshots/save-explicit-8192.png)、[save-auto-zero.png](screenshots/save-auto-zero.png) | 先存 8192 → PUT `reasoning_max_output_tokens_default: 8192`；清空再存 → PUT `...: 0`（后端 schema 接受 0）；刷新后输入框为空、占位「自动」 |
| 保存失败保留输入（注入 400） | [save-failure-preserved.png](screenshots/save-failure-preserved.png) | PUT 400 → toast「保存失败 / 模拟：保存被拒绝」，温度输入 1.2 保留，无「已保存」提示，保存按钮仍可用 |
| 搜索定位 | [search-locate-document-knowledge.png](screenshots/search-locate-document-knowledge.png) | 搜「文档与知识库」→ 命中「文档与知识库（搜索与知识库）」→ 落在 `search-knowledge`，banner「已定位到：搜索与知识库 · 文档与知识库」，目标卡进入视口（内容区 scrollTop 1203，说明定位滚动未被下面的归零修复打断） |

## 本次验收中发现并修复

1. **切换叶子沿用上一页滚动位置（真实缺陷，已修）**。长页（数据与维护，scrollHeight 2279）滚到底后切到短页（生成与网络，max 30），内容区停在 scrollTop=30，页面标题被裁掉。修法：`shell.tsx` 把当前页 key 传给 `SettingsContentColumn`，内容区在 key 变化时归零；卡定位（`flashKey` 期间）跳过归零，避免与 `SystemLeafWrapper` 的滚动互相拉扯。实测：同一操作后 `scrollTop` 由 30 → 0；搜索定位仍能滚到卡（1203）。
2. **全局系统提示词的优先级文案与实现不符（已修）**。后端 `chat-request-builder` 的基础提示词顺序是「会话 → 全局 → 内置默认」，个人提示词作为 `[用户个人偏好]` 追加层，不顶掉基础层。页头、卡片副标题、卡内说明三处统一为：页头「所有会话共用的基础提示词；会话可以覆盖它，个人偏好作为追加层」、卡副标题「所有会话的基础提示词：会话 > 全局 > 内置默认；个人偏好独立追加」、卡内「基础提示词：会话 > 全局 > 内置默认；个人偏好作为独立内容追加，不会顶掉这三层」。
3. **循环 import（architecture:check 失败，已修）**。概览页为读导航树 import registry，而 registry 懒加载概览，形成 `registry → overview → registry`。抽出纯数据层 `system-settings-tree.tsx`（类型、导航树、卡索引、位置描述，不含任何组件 import），registry 以 `export *` 保留原导出名，概览只依赖数据层。`node scripts/check-architecture.mjs` → `OK: 4 package sources, no cycles`。

## 已确认不属于缺陷

- **深链被弹回个人设置**：两次复现后测得 `/api/auth/actor` 与 `/api/auth/me` 均返回 500，**验收期间后端 13001 暂时无响应**（连接被拒），前端把认证失败按匿名处理，系统分区因此重定向到个人设置。后端有响应时同一深链可正常落在 `/main/settings/system`（[route-default-wide.png](screenshots/route-default-wide.png)）。后端恢复后的复测通过，无需修改前端认证流程。
- **搜索定位时「已定位到」提示条随内容滚出视口**：卡片在页面深处时提示条不常驻。属体验优化建议（把 banner 固定在内容区顶部），非本轮缺陷，未改（该组件不在本轮写入范围）。

## 未覆盖 / 未验证

- 品牌配色 6 个颜色、MCP/Skill 分段内的编辑弹窗、连接向导内的逐字段错误：本轮未逐项截图（配色属其他 owner 的卡片结构，未改动本页交互）。
- 深色主题下的对比度：未单独截图验证。
- 生产构建下的同一流程：本轮为 dev + 隔离库，未在 `next build` 产物上复跑。

## 最终文案与历史配置复验

- 会话默认配置三处文案已补拍：[leaf-session-defaults-final.png](screenshots/leaf-session-defaults-final.png)。页面实测文本：页头「所有会话共用的基础提示词；会话可以覆盖它，个人偏好作为追加层」／卡副标题「所有会话的基础提示词：会话 > 全局 > 内置默认；个人偏好独立追加」／卡内「基础提示词：会话 > 全局 > 内置默认；个人偏好作为独立内容追加，不会顶掉这三层。支持 {day time}（将替换为服务器当前时间）。」
- 搜索与知识库的「旧 KB 组合」提示已补拍：[kb-legacy-combination-hint.png](screenshots/kb-legacy-combination-hint.png)、[kb-legacy-combination-hint-card.png](screenshots/kb-legacy-combination-hint-card.png)。制造方式：隔离库 PUT `{"knowledge_base_enabled":true,"rag_enabled":false}`（200，读回 kb=true / rag=false），重载后该卡读作「聊天附件 + 知识库」并显示「检测到知识库已开启但文档解析关闭：知识库依赖文档解析能力，保存本页会一并重新开启文档解析（不会关掉知识库）。」，同时提示 Embedding 未就绪；截完已还原为 `false/false`。
  - 注意：这组键必须走 snake_case。用 camelCase（`knowledgeBaseEnabled`/`ragEnabled`）PUT 会 200 但字段被忽略、页面仍读作「关闭」，容易被误判成「提示不生效」。

## 验收期间的环境故障与补齐

**1）后端短暂无响应。** 补拍前 `13001` 拒连，`/api/auth/actor` 与 `/api/auth/me` 返回 500，前端把认证失败按匿名处理，深链 `/main/settings/system` 被重定向到个人设置（[state-deeplink-cold.png](screenshots/state-deeplink-cold.png) 为当时现场）。后端恢复后同一深链正常落在 `/main/settings/system`（[route-default-wide.png](screenshots/route-default-wide.png)），**不是前端竞态，也不需要在认证上做改动**。

**2）系统设置路由崩溃在重建 dev 缓存后恢复。** 现象：`/main/settings/system` 与搜索页整页变成 Next 的 “Application error: a client-side exception has occurred”，加时间戳绕 HTTP 缓存后仍稳定复现；页面级异常 `TypeError: (0 , ..._web_search_constants__.normalizeEngineList) is not a function`，抛出点 `web-search-card.tsx:57`（`useState` 初始化器），来源是 `web-search/web-search-constants.ts:6` 的别名再导出 `export { WEB_SEARCH_RANGES, normalizeWebSearchEngines as normalizeEngineList } from "@aichat/shared"`。当时据此怀疑代码，但证据不支持：`packages/shared/dist` 已重建且 node 侧该符号为 function，`packages/frontend` 解析到的就是这份 dist，dev 进程也晚于该次构建启动。**修好依赖链接（pnpm workspace 重新 link 到 `@aichat/shared` 新 dist）并保留旧 `.next`、用全新缓存重启后，同一页面恢复正常（无任何代码改动）**。依赖修正后，单独重建 dev 缓存即恢复，支持旧编译产物导致故障的判断；最终页面复验通过。
   - 现场与过程证据：[output/settings-verification/regression-client-error.png](../../../output/settings-verification/regression-client-error.png)，旧缓存保留在 `output/settings-verification/next-cache-before-shared-relink`；恢复后同一路由与搜索页实测 0 pageerror、0 console error（导航与「搜索与知识库 / 文档与知识库」两卡均正常渲染）。
   - 给发布流程的提示：`packages/shared` 改了导出后，若 dev 侧出现「符号存在但打包结果是 undefined」，先清 `.next` 再怀疑代码。

## 结论

11 个叶子在宽屏与 390 下均通过：标题与分组一致、无横向溢出；**正常态页面 0 console error、0 pageerror**。加载/错误/空/禁用/焦点/长内容/保存失败/0=自动/搜索定位/旧 KB 组合提示全部按预期工作，其中错误态与保存失败两行是注入 500/400 的预期失败请求，不计为缺陷。

验收期间修掉 3 项：1 个真实交互缺陷（切叶子沿用上一页滚动位置）、1 组文案不一致（会话默认配置三处优先级）、1 处架构循环依赖（registry ↔ overview）。另记录 2 项环境问题（后端短暂无响应、dev webpack 缓存陈旧），均已恢复且无需代码改动。