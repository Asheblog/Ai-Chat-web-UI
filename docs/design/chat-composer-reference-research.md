# 聊天输入区参考研究（ChatGPT / Claude / Gemini / Perplexity）

检索日期：2026-11-15 · 范围：桌面与手机消息输入区的附件与工具收纳、已选模式可视、模型选择、移动适配 · 用途：Pandoratobe Chat 输入区重设计决策依据。

证据分级：**A** = 直接读到官方帮助页正文的界面描述；**B** = 官方正文仅经搜索索引片段/发布说明转述获得，未见完整页面；**C** = 由 A/B 推断的设计结论（非界面事实）。本报告未实测任何产品的手机客户端界面。

## 1. 来源

| # | 来源（官方） | 取到的内容 | 等级 |
| --- | --- | --- | --- |
| 1 | [Claude · Get started](https://support.claude.com/en/articles/8114491-get-started-with-claude) | 输入框左下「+」与「/」命令入口；模型名显示位置（桌面在输入框下、手机在屏幕顶部） | A |
| 2 | [Claude · Change the model, effort, and thinking settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings) | 发送键旁的模型菜单同时管理模型 / effort / thinking；选中值显示在发送键旁 | A |
| 3 | [Claude · Upload files](https://support.claude.com/en/articles/8241126-upload-files-to-claude) | 「+」→「Add files or photos」；拖拽与剪贴板粘贴；单聊 20 个文件 / 500MB | A |
| 4 | [Gemini · Upload & analyze files](https://support.google.com/gemini/answer/14903178?hl=en) | 文档描述的底部输入框「Add files」入口，内含 Files / More Uploads（Drive、Import Code→Upload folder、Notebooks）；单次最多 10 个文件 | A |
| 5 | [Gemini · Use Deep Research](https://support.google.com/gemini/answer/15719111?hl=en) | 「Add Files ▸ Deep Research」；可再「Add Files ▸ Files」；独立「Sources」控件；默认含 Google Search 且可取消 | A |
| 6 | [Gemini · 使用 Gemini 应用](https://support.google.com/gemini/answer/13275745?hl=en) | 默认自动选模型，需手动切换时从菜单选择 | A |
| 7 | [Perplexity · What is Perplexity Pro](https://www.perplexity.ai/help-center/en/articles/10352901-what-is-perplexity-pro)、[Why can't I see focus mode](https://www.perplexity.ai/help-center/en/articles/10354759-why-can-t-i-see-focus-mode-on-my-search-bar) | 搜索模式（Best / Pro Search / Reasoning / Deep Research）；模型默认 Best 或手动选；企业版 Focus 被「Choose sources」（Web / Org Files / Web + Org Files / None）取代 | B |
| 8 | [ChatGPT · Release notes（2026-04-28 Easier model selection）](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) | 模型选择移入 composer、thinking effort 收进模型选择器 | B |

## 2. 四个观察点

### 2.1 附件与工具收纳
- Claude：单一「+」在输入框**左下**，菜单项为「Add files or photos」，另有「/」触发命令与技能。附件也接受拖拽与粘贴（A）。
- Gemini：「Add files」把**附件与工具放在同一入口**——Files、Drive、Import Code（含上传整个文件夹）、Notebooks，Deep Research 也在同一菜单里（A）。这是四家中最强的「一个加号收全部」证据。
- 结论：附件与工具不必分列两个按钮；Gemini 的层级是「+ → 附件类 / 工具类」，菜单项数约 4–6 个，未出现长列表（C）。

### 2.2 已选模式（工具）如何可见
- Gemini：模式在选择后仍以独立控件形态常驻输入区——「Add Files ▸ Files」与「Sources」都是可再次点开的按钮，Sources 默认选中 Google Search 且可取消（A）。即**已选状态 = 输入框内一个带文字的按钮**，不是隐藏开关。
- Claude：不使用「模式 chip」，而是把已选设置写成文本：选中模型与 effort 显示在发送键旁（A）。
- 结论：可复用的两种表达——(a) 输入框内 chip/按钮显示已选并可直接关掉；(b) 发送键旁一行小字汇总当前模型与强度（C）。

### 2.3 模型选择
- Claude：模型菜单**唯一入口在发送键旁**；同一菜单下挂 effort 子级、effort 内挂 thinking 开关；有「More models」二级列表；改动从下一条回复生效（A）。
- Gemini：默认自动选模型，手动切换走菜单（A）。
- ChatGPT：模型选择已从顶栏移入 composer，thinking effort 并入模型选择器（B）。
- 结论：模型 + 推理强度应收敛为**一个控件**，放在发送键一侧，用子菜单分层，而不是顶栏与输入区两个入口（C）。

### 2.4 移动端适配
- Claude 官方明确区分渲染位置：桌面与 Web 把模型显示在**输入框下方**，手机放在**屏幕顶部**（A）。这提示移动端可把模型移出输入区以省高度。
- Gemini：Deep Research 在手机端只以**通知**形式回传结果，未描述手机端 composer 差异（A）。
- 缺口：四家手机端 composer 的实测截图未取得，手机端「+」是否走 bottom sheet 无官方原文支撑，属 C 级推断。

## 3. 对 Pandoratobe Chat 的建议

现状（`mobile-composer.tsx` + `composer-toolbar-primitives.tsx`，2026-11-15 核对）：工具栏平铺 **知识库、思考、联网、深度研究、Python** 五个控件 + 附件按钮；**effort 在「更多操作」菜单内，Skill 与 MCP 在技能面板内**；模型由发送键侧的 `ComposerModelActions` 承载。

以下为**研究建议，非本次最终设计**：

1. **平铺项按频次分层**：附件维持独立快捷入口；联网、深度研究、Python 这类「单次任务级」开关收进工具面板；知识库属「每轮都要看」的状态，可留在工具栏；思考是否留在工具栏两可——它的值是强度语义，归入工具设置同样成立。对齐来源 4/5 的层级思路。
2. **已选项常驻可见**：被收进面板的工具在输入框上方以 chip 呈现（图标 + 名称 + 可关闭），超 3 个折叠为「+N」，避免「面板关掉就看不见已选」。
3. **模型菜单承担强度选择**：可把 effort 收进模型菜单子级（来源 2 的结构），与模型名一起显示在发送键旁；但需先判定强度是否属模型私有语义（见下条）。
4. **手机用底部面板，桌面用锚定弹层**：工具面板与模型列表在手机走 bottom sheet（单列、行高 ≥44px、可拖拽关闭），桌面走按钮锚定 popover。
5. **手机端压缩模型区**：模型行只保留一行可点文本（当前值），完整列表进 sheet；高度吃紧时可按来源 1 把当前模型上移到页顶，但选择动作仍回输入区。

本次设计采用**附件独立快捷入口 + 工具面板**；根据用户反馈，**模型与思考强度在同一选择器内配套显示和设置**，桌面菜单收窄为 288px。具体采纳与交互细节见 [设计说明](./chat-composer-redesign.md)。

## 4. 限制

- 未实测四家产品的手机客户端界面；所有手机端结论均为文档推断（C），除来源 1 明确给出的「手机上模型位于屏幕顶部」。
- 未取得可再分发的官方截图；本报告不含截图。
- ChatGPT 与 Perplexity 官方帮助站从本机网络不可达（403 / 连接超时 / Wayback 429），其事实取自官方页面在搜索索引中的原文片段与官方发布说明的转述，等级为 B，不作为界面细节的唯一依据。
- 未覆盖语音输入、@ 提及、斜杠命令面板、输入区高度自适应策略。
