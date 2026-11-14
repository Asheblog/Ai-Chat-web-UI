# Ink & Mist · AIChat 界面重设计规范

版本 v2 · 设计稿：Figma 文件 `4YLYoLabolKlkjKl3MqshK`，六页：设计系统、聊天、设置、组件与状态、认证与分享、对战与日志。完整节点与实现映射见 [完整界面规范](ui-completion-ink-mist.md)。
决策背景见 [ADR-0042](../adr/0042-ink-and-mist-neutral-first-design-system.md)。

## 1. 方向

中性优先、发丝线结构、单一信号色。三条硬规则：

1. 层级靠**色阶 + 1px 发丝线**表达，不靠阴影、渐变、加粗描边。
2. **主操作 = 墨黑**，**AI 动作 = 信号色**，除此之外不出现强调色。
3. 中文正文 **15px / 1.8**；元信息与数字用等宽；留白按 4 的倍数。

这套骨架的收益是：品牌换色只影响信号色，页面层级不变（对应 ADR-0033 的 Brand Theme 机制）。

## 2. 色彩 token

Figma 变量集合 `AIChat Tokens` 与下表一一对应；CSS 使用项目既有的 HSL 三元组写法（`hsl(var(--x))`）。

### 浅色

| Token | Hex | HSL 三元组 |
| --- | --- | --- |
| `canvas` | `#F7F7F4` | `60 16% 96%` |
| `surface` | `#FFFFFF` | `0 0% 100%` |
| `surface-subtle` | `#F2F2EE` | `60 13% 94%` |
| `surface-hover` | `#EDEDE8` | `60 12% 92%` |
| `border` | `#E7E7E1` | `60 11% 89%` |
| `border-strong` | `#D9D9D2` | `60 8% 84%` |
| `text` | `#14161A` | `220 13% 9%` |
| `text-secondary` | `#41474E` | `212 9% 28%` |
| `text-tertiary` | `#6A6F74` | `210 3% 43%` |
| `accent` | `#0F766E` | `175 77% 26%` |
| `accent-soft` | `#E7F2F0` | `169 30% 93%` |
| `accent-text` | `#0B5D57` | `176 79% 20%` |
| `user-bubble` | `#F1F1EC` | `60 15% 94%` |
| `code-bg` | `#F5F5F1` | `60 17% 95%` |
| `danger` | `#C0392B` | `6 63% 46%` |
| `success` | `#15803D` | `142 72% 29%` |
| `warning` | `#A16207` | `35 92% 33%` |

### 深色

| Token | Hex | HSL 三元组 |
| --- | --- | --- |
| `canvas` | `#0D0F0B` | `90 15% 5%` |
| `surface` | `#12140F` | `84 14% 7%` |
| `surface-subtle` | `#1B1E17` | `86 13% 10%` |
| `surface-hover` | `#23261E` | `82 12% 13%` |
| `border` | `#2A2E26` | `90 10% 16%` |
| `border-strong` | `#383D33` | `90 9% 22%` |
| `text` | `#EDEEE9` | `72 13% 92%` |
| `text-secondary` | `#B4BAAD` | `88 9% 70%` |
| `text-tertiary` | `#8E9489` | `93 5% 56%` |
| `accent` | `#34D3C4` | `174 64% 52%` |
| `accent-soft` | `#16302C` | `171 37% 14%` |
| `accent-text` | `#5FE3D4` | `173 70% 63%` |
| `user-bubble` | `#1D2019` | `86 12% 11%` |
| `code-bg` | `#191C15` | `86 14% 10%` |
| `danger` | `#E0796D` | `6 65% 65%` |
| `success` | `#6FCF97` | `145 50% 62%` |
| `warning` | `#D9A94A` | `40 65% 57%` |

### 实测对比度（写死，改色前先测）

| 组合 | 对比度 |
| --- | --- |
| text / canvas | 16.9:1 |
| text-secondary / canvas | 8.8:1 |
| text-tertiary / canvas | 4.7:1 |
| 白字 / 墨黑主按钮 | 18.1:1 |
| accent-text / accent-soft | 6.8:1 |
| 深色 text / surface | 15.9:1 |
| 深色 text-tertiary / surface | 6.0:1 |

## 3. 排版

字体：拉丁 `Source Sans 3`（项目已自托管），CJK 走系统栈（ADR-0041）。Figma 预览用 `Noto Sans SC`，其拉丁字形与 Source Sans 同源，因此设计稿与实现的字形差异可忽略。

| 名称 | 字号 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| Display | 34 / 1.18 · -0.6 字距 | Bold | 空状态主标题、登录大标题 |
| H1 | 24 / 1.3 · -0.3 | Bold | 页面标题 |
| H2 | 18 / 1.4 | Bold | 卡片组标题、区块标题 |
| H3 | 15 / 1.45 | Medium | 卡片标题、列表主字段 |
| Body | 14 / 1.75 | Regular | 表单说明、正文 |
| Body-Sm | 13 / 1.7 | Regular | 表格单元格、次要正文 |
| Chat | 15 / 1.8 | Regular | 对话正文 |
| Caption | 12 / 1.55 | Regular | 辅助说明、时间戳 |
| Label | 11 / 1.4 · 0.5 字距 | Medium | 分组标签（置顶 / 今天 / BUTTONS） |
| Mono | 12.5 / 1.7 | Regular | 代码、token 数、耗时 |

## 4. 间距、圆角、控件高度

- 间距阶梯：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64（4pt 栅格）。
- 圆角：8（小控件）/ 10（按钮、输入）/ 12（卡片、面板）/ 16（composer）/`999`（chip、pill、开关、头像）。
- 控件高度：28（chip、图标按钮）/ 32（次级按钮、tab）/ 36（主按钮、输入框）/ 42（登录页输入）。
- 点击区域最小 32×32，移动端 44×44；相邻可点元素间距 ≥ 8。

## 5. 组件清单

| 组件 | 规格要点 |
| --- | --- |
| Button / primary | 高 36，圆角 10，底色 `text`，字 13 Medium 白；hover 降 L 4% |
| Button / secondary | 白底 + `border` 发丝线，字 `text`；hover 底色 `surface-subtle` |
| Button / AI action | `accent` 底 + 白字，仅用于"AI 生成/采纳"这类动作 |
| Button / ghost · danger · disabled | ghost 无底色；danger 白底红字；disabled `surface-subtle` + `text-tertiary` |
| Icon button | 32×32，圆角 8，图标 16，1.6 描边 |
| Input · Focus | 高 36，圆角 9，`surface` 底；focus 用 1.5px `accent` 边框 + 同色光标 |
| Select · Segmented | Select 高 34 带 chevron；Segmented 外底 `surface-subtle`，选中项白底 + 发丝线 |
| Switch | 38×22，开 `accent`，关 `surface-hover` + 发丝线，白色圆钮 18 |
| Message / user | 右对齐气泡，`user-bubble` 底，圆角 14，内边距 11/15，最大宽 ~520 |
| Message / assistant | 无气泡，头像 26 + 正文列 722；操作行在文末，默认低对比，hover 提升 |
| Reasoning pill | `accent-soft` 底 + `accent-text` 字，高 30，圆角 pill，含耗时与展开箭头 |
| Tool step | 白色卡片 + 发丝线，头部 38 高（图标 + 名称 + 耗时 + chevron），来源 chip 行 38 高 |
| Code block | `code-bg` 底，圆角 10，头部 32 高（语言 + 复制），正文 12.5 等宽 |
| Status pill | 高 22，圆点 5 + 11 Medium；已完成为 success、失败为 danger、排队为中性 |
| Table | 表头 38 高 `surface-subtle`，行 46 高，行间 1px 上边线，无斑马纹 |
| Sidebar item | 高 34，圆角 8，选中态白底 + 发丝线 + 右侧 5px 信号点 |

## 6. 页面清单（Figma 页 / 帧）

| 页面 | 帧名 | 对应路由 |
| --- | --- | --- |
| 01 · 聊天 | `01 · 新会话` | `/main` |
| 01 · 聊天 | `02 · 会话中` | `/main/[sessionId]` |
| 02 · 设置 | `03 · 设置` | `/main/settings/personal` |
| 05 · 对战与日志 | `04 · 模型大乱斗` | `/main/battle` |
| 05 · 对战与日志 | `05 · 运行日志` | `/main/logs` |
| 04 · 认证与分享 | `06 · 登录` | `/auth/login` |
| 01 · 聊天 | `07 · 移动端 · 会话` | 响应式 / Android |
| 01 · 聊天 | `08 · 深色 · 会话中` | 深色模式 |

预览（2x 导出，位于 `docs/design/screens/`）：

| 页面 | 截图 |
| --- | --- |
| 新会话 | ![](./screens/01-new-chat.png) |
| 会话中 | ![](./screens/02-conversation.png) |
| 设置 | ![](./screens/03-settings.png) |
| 模型大乱斗 | ![](./screens/04-battle.png) |
| 运行日志 | ![](./screens/05-logs.png) |
| 登录 | ![](./screens/06-login.png) |
| 移动端 | ![](./screens/07-mobile.png) |
| 深色会话 | ![](./screens/08-dark.png) |

结构要点：

- **会话中**：居中可读消息列；思考与工具为折叠步骤；composer 贴底、圆角16，工具在左、模型与发送/停止在右，页头不重复模型入口。
- **设置**：个人四分区、系统真实导航叶子、独立页hash与弹窗局部导航保持；内容宽度沿个人max752/系统max988、桌面导航232；移动使用紧凑折叠导航。保留各页原有即时或批量显式保存机制，不新增全局假保存条或不存在的设置搜索。
- **模型大乱斗**：保留新建、配置、运行、结果流程与pass@k含义；单模式入口明确指向多模型对战。排名用序号、字重与发丝线，指标只显示已有数据。
- **运行日志**：仅「系统日志 / 任务追踪」两个页签；筛选分页沿真实接口。长内容换行，ctx支持键盘展开，首次失败/刷新失败与真正空结果分别显示。
- **登录**：左侧 600 品牌面板（雾底、标题、三条能力、页脚），右侧表单列 352 居中。

## 7. 与现有 token 的映射

**实现策略（已落地）**：保留全部既有 shadcn 变量名，只替换取值；规范里没有对应旧变量的语义以新增变量落地。200+ 组件类名与 BrandThemeInjector 的契约因此都不用改。落地文件：`packages/frontend/src/app/globals.css`、`packages/frontend/tailwind.config.ts`。

| 规范 token | 保留的既有变量 | 新增变量 | 浅色值 | 深色值 |
| --- | --- | --- | --- | --- |
| `canvas` | `--background` | — | `60 16% 96%` | `90 15% 5%` |
| `surface` | `--surface` `--card` `--popover` | — | `0 0% 100%` | `84 14% 7%` |
| `surface-subtle` | — | `--surface-subtle` | `60 13% 94%` | `86 13% 10%` |
| `surface-hover` | `--surface-hover` | — | `60 12% 92%` | `82 12% 13%` |
| `border` | `--border` `--input` | — | `60 11% 89%` | `90 10% 16%` |
| `border-strong` | — | `--border-strong` | `60 8% 84%` | `90 9% 22%` |
| `text` | `--foreground` | — | `220 13% 9%` | `72 13% 92%` |
| `text-secondary` | `--muted-foreground` | — | `212 9% 28%` | `88 9% 70%` |
| `text-tertiary` | — | `--ink-tertiary` | `210 3% 43%` | `93 5% 56%` |
| `accent`（信号色） | `--primary` `--ring` | `--signal` | `175 77% 26%` | `174 64% 52%` |
| `accent-soft` | — | `--signal-soft` | `169 30% 93%` | `171 37% 14%` |
| `accent-text` | — | `--signal-text` | `176 79% 20%` | `173 70% 63%` |
| `user-bubble` | — | `--user-bubble` | `60 15% 94%` | `86 12% 11%` |
| `code-bg` / header / border / text | `--code-bg` `--code-header` `--code-border` `--code-text` | — | `60 17% 95%` / `60 13% 94%` / `60 11% 89%` / `220 12% 14%` | `86 14% 10%` / `86 13% 13%` / `90 10% 16%` / `90 8% 86%` |
| `danger` / `success` / `warning` | `--destructive` `--success` `--warning` | — | `6 63% 46%` / `142 72% 29%` / `35 92% 33%` | `6 65% 65%` / `145 50% 62%` / `40 65% 57%` |
| 侧栏底 / 中性底 | `--sidebar-bg` `--muted` `--secondary` | — | `60 16% 96%` / `60 13% 94%` | `90 15% 5%` / `86 13% 10%` |
| 悬停浅底 | `--accent`（shadcn 语义，非信号色） | — | `169 20% 95%` | `174 22% 13%` |

三条实现约束，页面与组件改造时照此使用：

1. **`accent` 有两套含义**：shadcn 的 `bg-accent` 仍是「悬停浅底」；本规范的强调色在 tailwind 里叫 `signal`（`bg-signal` / `text-signal` / `bg-signal-soft` / `text-signal-text`）。`primary`(= `signal`) 是青瓷，不是墨黑：**主操作按钮的墨黑底色由组件层用 ink（`bg-foreground` + `text-background`）实现**，两者不要混用。
2. **`--signal` 跟随 `--primary`**（`--signal: var(--primary)`）。BrandThemeInjector 覆盖 `--primary` 时，信号色链路与焦点环一起换；`--signal-soft` / `--signal-text` 不参与注入，仍是 Ink & Mist 出厂值，品牌色相明显偏离青瓷时需一并覆盖这两个变量。
3. **tailwind 新增键**：`canvas`、`surface`（`subtle` / `hover`）、`borderStrong`、`ink`（DEFAULT / `secondary` / `tertiary`）、`signal`（soft / text）、`userBubble`、`codeBg`；原有的 `border` `input` `ring` `background` `foreground` `primary` `secondary` `muted` `accent` `popover` `card` `destructive` 全部保留。

品牌换色只需覆盖 `--primary`（必要时加 `--signal-soft` / `--signal-text`），其余 token 不动。若希望保留原陶土色，把 `--primary` 改回 `18 65% 52%`、`--signal-soft` 改 `18 60% 95%`、`--signal-text` 改 `18 65% 28%` 即可，骨架不变。

## 8. 落地顺序

1. **token 层**：改 `globals.css`，按上表替换变量名与值（正确性优先，不做旧名别名）；同步微调 `tailwind.config.ts` 的语义色映射。
2. **基础组件层**：`components/ui/` 的 button / input / select / switch / card / table / dropdown 按第 5 节规格改造。
3. **壳层**：`components/sidebar.tsx`、`components/app-shell.tsx`、`app/main/settings/_components/` 按新导航密度重排。
4. **页面**：按第 6 节顺序逐页套用；每页完成后用 playwright 截图核对默认 / hover / loading / empty / 窄屏五种状态。
5. **验收**：真实消息与配置内容优先；v2覆盖1440/390/320明暗、系统十叶及关键恢复状态，范围与证据见 [最终验证](ui-completion-verification.md)。

## 9. 完整改造与业务边界

本轮在首版基础上补齐模型选择器、输入区、设置导航及长内容、日志状态、认证、公开分享、对战与弹窗反馈。六页设计和原生组件节点见 [完整界面规范](ui-completion-ink-mist.md)，实际浏览器与检查结果见 [实施记录](../superpowers/plans/2026-11-14-ui-completion.md)。

- 侧栏顶部仅保留新建聊天；对战与设置移至底部安静导航，既有路由与权限保持。
- 会话输入区桌面上限760px，Welcome上限720px；左工具独立滚动，右模型与发送/停止不参与滚动。
- 选择器桌面600×496、家族栏144px；移动抽屉。模型复合身份、来源、收藏、最近和原有能力筛选保持。
- 设置保留每页实际保存边界：个人字段即时保存，高级/推理网络等已有整页显式保存继续使用原机制。
- 导航hash、弹窗局部导航、懒加载、username认证、对战pass@k和只读分享分页沿用真实业务。
- 品牌信号色沿现有注入契约，软背景/文字色继续使用明确语义变量。

## 10. 验收记录

首版提交 `2d73504` 的118文件697测试、18路由构建及CI结果仅代表首版；本轮新增交互与布局的最终关口单独记录在实施记录。浏览器使用合成账户/模型/消息fixture检验前端渲染与交互，不调用付费模型；实际后端模型推理不计入该前端验收。

初始截图保留在 `docs/design/screens/` 供历史比较。v2设计组件和反馈预览在 `docs/design/assets/ui-v2/`；最终浏览器报告位于 `output/playwright/ui-v2/`，加载骨架和导航超时截图不计完成证据。
