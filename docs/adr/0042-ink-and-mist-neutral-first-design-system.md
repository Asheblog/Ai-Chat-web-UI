---
status: proposed
---

# Ink & Mist：中性优先的界面骨架与信号色

ADR-0033 定下了「扁平暖色画布 + 暖橙 Primary」的默认气质，解决了早期色板散乱的问题；但它让**强调色同时承担结构色**（选中态、主按钮、链接、图标高亮都用 primary），这与「品牌主题可覆盖色板」的约定互相拉扯：一旦管理员换了 brand_primary，整站的层级关系会跟着变，浅色品牌色甚至会让主按钮对比度掉到不可用区间。

因此提出一次视觉层重设计（不改变信息架构与功能）：

1. **结构只用中性色阶 + 1px 发丝线**。画布（雾）、面板（白）、三级文字（墨/次/弱）构成全部层级；不使用阴影、渐变、2px 以上描边来制造高低。
2. **强调色降级为信号色**。它只出现在：主操作按钮、AI 进行态（生成中/深度思考）、选中指示、焦点环、关键数据。品牌换色时，被影响的只有这些位置，页面骨架保持稳定。
3. **主操作按钮用墨黑**（`--text` 作底色 + 白字，对比度 18:1）。品牌色不再决定主按钮，避免"换品牌色即换主视觉"的连锁反应。
4. **排版沿用 ADR-0041 的字体栈**（Source Sans 3 + 系统 CJK），只重定比例：正文 15/1.8、表单与说明 13/1.7、元信息 12/1.55、标签 11 + 0.5 字距；数字统一等宽，保证表格与耗时列对齐。
5. **圆角与控件高度收敛为有限集合**：圆角 8 / 10 / 12 / 16 / pill，控件高 28 / 32 / 36，间距按 4 的倍数递进。
6. **Brand Theme 契约不变**（仍覆盖 primary / background / surface / foreground 等），但新增约束：被覆盖后的正文与次要文字必须 ≥ 4.5:1；`accent-soft` 由品牌色按同色相 + 93% 亮度推导，不作为独立配置项。
7. 默认信号色由暖橙改为**青瓷 `#0F766E`**（深色 `#34D3C4`）：它与墨黑主按钮不争抢，且在中性画布上同时胜任"AI 状态"与"链接"两种语义。若产品希望保留原品牌橙，只需替换 `--accent / --accent-soft / --accent-text` 三个变量，骨架不受影响。

影响面：`packages/frontend/src/app/globals.css` 的 token 层、`components/ui/*` 基础组件、侧边栏与设置壳层，以及各页面内联色值。详细规范与页面清单位于 `docs/design/ui-redesign-ink-mist.md`。

本 ADR 不改变任何接口、数据结构或权限逻辑，也不改变 ADR-0033 的 Brand Theme 注入机制。

## 实现注记（2026-11-14 · token 层落地）

- **落地范围**：`packages/frontend/src/app/globals.css`（变量层、`.v2-*` 组件类、Markdown 与代码块外观、滚动条、焦点环）与 `packages/frontend/tailwind.config.ts`（语义色映射）。组件与页面由并行任务改造，本注记只固定 token 层契约。
- **变量命名**：保留全部既有 shadcn 变量名，只替换 HSL 取值；规范中的 canvas / surface-subtle / border-strong / text-tertiary / accent 等语义通过新增 `--surface-subtle`、`--border-strong`、`--ink-tertiary`、`--signal`、`--signal-soft`、`--signal-text`、`--user-bubble` 落地。不改名、不留旧名别名。
- **`--signal: var(--primary)`**：信号色默认即青瓷主色，但不独立取值。BrandThemeInjector 覆盖 `--primary`（连同 `--ring` / `--sidebar-active` / `--accent-color`）时信号色一起跟随，符合本 ADR 第 2 条「换品牌只影响信号位置」。`--signal-soft` / `--signal-text` 不在注入清单内，仍是出厂值；品牌色相明显偏离青瓷时需一并覆盖这两个变量，否则浅底与文字会和信号色不同色相。
- **结构约束的落地方式**：`globals.css` 内已无任何阴影与渐变（焦点、选中、状态一律用色阶 + 1px 发丝线表达）；`:focus-visible` 统一 `1.5px solid hsl(var(--signal))` + `outline-offset: 2px`；`.v2-*` 系列圆角固定 8 / 10 / 12 / 16，hover 只改一阶底色，过渡 160ms；滚动条 thumb 用 `--border-strong`、track 透明。
- **数字列**：新增 `.num-tabular`（仅 `tabular-nums`）与 `.num-mono`（等宽栈 + `tabular-nums`），供耗时 / token / 计数列使用，流式刷新时不跳动。
- **圆角**：`--radius` 保持 0.75rem（12px）；`--radius-composer` 由 1.25rem 收敛为 1rem（16px），对应第 5 条。
- **兼容性**：Brand Theme 注入的 5 个变量名（`--primary` / `--background` / `--surface` / `--foreground` / `--muted-foreground`）全部仍然有效；`--background-alt`、`--primary-hover`、`--accent-color`、`--sidebar-*`、`--hero-*`、`--code-*` 等既有辅助变量保留并重新取青瓷/中性值，组件层引用不断链。
- **文档同步**：`docs/design/ui-redesign-ink-mist.md` §7 的映射表已按实际实现重写，含 `accent` 双语义与品牌换色的操作方式。
