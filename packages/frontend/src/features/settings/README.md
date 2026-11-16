# Settings Feature

该目录承载与系统设置相关的领域模块，遵循“features/<domain>”的切分方式：

- `pages/system-models`：模型覆写/能力开关面板及批量操作逻辑，依赖 `useSystemModels` 服务钩子（旧 `pages/system-general` 已并入 `components/settings/pages` 下的 branding/users-registration/tools-extensions/data-maintenance 等页；其中 `tools-extensions` 现在只剩四张功能卡，页面壳已删除）。

## 系统设置导航

系统设置采用左侧三级导航：一级为 `个人设置` / `系统设置`，二级为系统设置工作域（或顶级叶子），三级为具体设置页面。右侧内容区只渲染当前三级页面，不再承载模块切换 tab。

`systemSettingsTree` 是「概览（入口状态摘要）+ 6 组导航」，共 11 个叶子。分组只在需要多个叶子时保留二级条目，其余拍平为顶级叶子；**所有旧叶子 key 保持不变**，因此 localStorage 里保存的旧模块、深链与浏览器返回都不会失效。

| 组 | 叶子 |
| --- | --- |
| `概览` | 概览（状态摘要，不做完成度清单） |
| `连接与模型` | 供应商与连接、模型管理、会话默认配置 |
| `搜索与知识库` | 搜索与知识库（顶级叶子） |
| `工具与扩展` | 工具与扩展（旧 key 仍为 `extensions`） |
| `用户与访问` | 用户与访问（旧 key 仍为 `users-registration`） |
| `数据与日志` | 数据与维护、日志与审计、生成与网络（高级，旧 key 仍为 `reasoning-network`） |
| `外观与站点` | 外观与站点（旧 key 仍为 `branding`） |

分组边界：全局系统提示词属于对话与模型（`model-connections → session-defaults`），不放在外观页；推理强度/温度/生成上限等按模型或按协议的参数收进「生成与网络（高级）」的「更多参数」；6 个品牌主题色收进「外观与站点」的「主题配色」。

## 工具与扩展页（`extensions`）

`components/settings/pages/extensions/ExtensionsPage.tsx` 是唯一页面壳，只做段路由与卡定位（`settings-flash-bus` + `extensions-sections.ts` 的卡路由）。5 个段分别取数、分别保存：

| 段 | 组件 | 内容 |
| --- | --- | --- |
| `overview` | `sections/overview-section.tsx` | 三类能力状态卡 + 待处理清单 + 其他增强入口（只读状态，不放开关） |
| `mcp` | `sections/mcp-section.tsx` | 全局开关 + 安装模板 / 连接 / 凭据 / 工具 / 绑定 |
| `skills` | `sections/skill-section.tsx` | 运行时开关 + 安装 / 待审批 / 版本 / 绑定 |
| `tools` | `sections/tools-section.tsx` | Python 工具卡 + Python 运行时管理卡 |
| `extra` | `sections/extra-section.tsx` | 模型大乱斗卡 + 标题智能总结卡 |

段组件约定（受控）：

- 段导航与次级标签的选中值由页面持有：`<McpSection segment onSegmentChange />`、`<SkillSection segment onSegmentChange />`。段组件自己存选中段会让卡定位/搜索跳转无法「先切段再滚动」。
- 需要系统设置的两段（`tools` / `extra`）在段内取一次 `useSystemSettings()`，再把 `settings` 与 `update` 作为受控 props 交给功能卡；卡不自行拉取设置，也不做整页原子保存。
- 每张可定位的卡都必须带 `extensions:<card>` 的 `data-card-key`，并在 `EXTENSION_CARD_ROUTES` 登记所属段（MCP / Skill 的卡还要登记次级标签）。
- 三个总开关各自只有一个控制点：`mcpGlobalEnabled`（MCP 段页头）、`chatDynamicSkillRuntimeEnabled`（Skill 段页头）、`pythonToolEnable`（Python 工具卡主开关）。总览只显示状态与入口。

新的页面组件应尽量保持无状态（依赖特定 hook 获取数据），以便同时在路由页面与 Dialog 中复用。README 持续更新以指导后续拆分。
