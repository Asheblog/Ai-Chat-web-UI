# AIChat Mobile — Ink & Mist UI 设计规范

- Figma 文件：[AIChat Mobile — Ink & Mist UI](https://www.figma.com/design/rwYFsmLNiRYjKWSqnFrQY4)
- File Key：`rwYFsmLNiRYjKWSqnFrQY4`

## 页面与节点索引

| 页面 | Page ID | 关键节点 | 说明 |
| --- | --- | --- | --- |
| `00 · Cover & Overview` | `0:1` | `3:150` | 封面总览与模块说明 |
| `01 · Design Tokens` | `3:79` | `3:168` | Light / Dark 双模式语义色板对照 |
| `02 · Components` | `3:80` | `4:2` – `4:91` | StatusBar、ChatHeader、Button、InputField、CotTimelineCard、UserBubble、AssistantMessage、ChatComposer、SessionListItem、ToggleRow |
| `03 · Screens (Light)` | `3:81` | `5:2` | 6 套浅色高保真页面（`390×844`） |
| `04 · Screens (Dark)` | `3:82` | `6:305` | 6 套深色高保真页面（绑定 `Semantic` Dark Mode） |

## 视觉与 Token 对应（对齐 Web 端 `Ink & Mist`）

- **浅色画布**：`#F6F6F2`（canvas）、`#FFFFFF`（surface）、`#F0F0EC`（subtle / user-bubble / code）、`#14161A`（ink primary）、`#E6E6DF`（1px 发丝线边框）、`#0F766E`（青瓷主信号色）。
- **深色墨绿夜底**：`#0D0F0B`（canvas）、`#131610`（surface）、`#1A1E16`（subtle / code）、`#22271D`（user-bubble）、`#ECEEE7`（paper primary）、`#282E23`（1px 发丝线边框）、`#36D3C4`（高可读青瓷信号色）。
- **服务端品牌色同步**：通过 `/api/settings/branding` 读取 `brand_primary` / `brand_background` / `brand_surface` 等覆写项，并遵循 `@aichat/shared/brand-theme` 的浅色纸面规则（深色模式保留墨绿夜底，只同步主信号色）。

## 视觉验收截图

- 浅色 6 屏总览：[1-screens-light.png](assets/mobile-refactor/1-screens-light.png)
- 深色 6 屏总览：[2-screens-dark.png](assets/mobile-refactor/2-screens-dark.png)
- 对话主界面细节：[3-chat-light-detail.png](assets/mobile-refactor/3-chat-light-detail.png)
