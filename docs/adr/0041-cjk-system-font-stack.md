---
status: accepted
---

# 中文使用系统字体栈，只对拉丁保留自托管字体

Web 端原先用 `next/font/google` 同时加载 Source Sans 3 与 Noto Sans SC，并把两者都设为 `font-display: optional`（ADR-0033 第 1 条）。Noto Sans SC 在 Google 侧被切成 404 条 `unicode-range` 切片，其中只有 4 条 latin 切片被 preload；中文切片只能在首帧排版后按需发现请求，冷缓存下赶不上 100ms 阻塞窗——首访中文落到系统字体、回访落到 Noto，同一页面在不同访问之间换字体。这 404 条声明还随全局 CSS 下发约 440KB（min）/126KB（gzip），构建期要额外下载 404 个外网文件。

因此约定：

1. **中文不用 webfont。** CJK 全字集（即便按常用字子集化）都无法在首帧前就绪，任何 CJK webfont 都只能退化为「跳字 / 闪白 / 首访降级」三选一，与「加载后不再跳字」互斥。中文交给系统 UI 字体链：`PingFang SC → Hiragino Sans GB → Microsoft YaHei UI → Microsoft YaHei → HarmonyOS Sans SC → Noto Sans CJK SC → Source Han Sans SC → WenQuanYi Micro Hei`。
2. **拉丁保留自托管 Source Sans 3**（SIL OFL 1.1，latin 切片单文件，`display: optional` + `preload`）。它足够小，能命中 100ms 窗口；极慢网首访退化也只是字母变成度量修正后的 Arial，不引起重排。
3. **代码块使用系统等宽栈**（`ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono`）。项目从未分发 JetBrains Mono / Fira Code，文档不再承诺这两个字体。
4. **字体栈只有一个事实源**：`globals.css` 的 `body` 定义 `--font-ui` / `--font-mono`，Tailwind 的 `fontFamily.sans/mono` 只引用变量。此前 Tailwind 与 `globals.css` 各维护一份家族列表，改一处必然漂移。
5. **字重约定**：微软雅黑只有 400/700，500/600 分别吸附到 400/700。中文层级优先靠字号、颜色、间距；强调用 600（Windows 渲染为 700），不写 650 这类中间值，也不用 500 作为唯一强调手段。
6. **版权**：Source Sans 3 与 Noto Sans CJK / 思源黑体均为 SIL OFL 1.1；微软雅黑、苹方等系统字体只在本机渲染、不随应用分发。项目不再随包分发 Noto Sans SC。

代价：Windows 上中文由 Noto Sans SC 变为微软雅黑 UI，并失去 500/600 真实字重。换来首屏 0 个 CJK 字体请求、全局 CSS 少约 126KB（gzip）、构建期少 404 次外网下载，以及「同一页面永远只渲染一种中文字体」。

本条取代 ADR-0033 第 1 条中关于字体的部分；设计 token、品牌主题覆盖边界、Conversation Stream 等其余约定不变。
