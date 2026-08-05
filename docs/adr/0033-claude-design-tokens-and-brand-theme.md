---
status: accepted
---

# Claude 默认主题与品牌主题覆盖边界

Web 端原先仅有 shadcn 色板与散落的任意字号/按钮高度，缺少产品级视觉规范，且「品牌与界面」只能改文字 LOGO，不能改主题色。

因此约定：

1. 默认视觉气质对齐 Claude：**扁平暖色画布**（`--surface` 与 `--background` 同色，无对角斜纹/多层纸卡套娃）、暖橙 Primary、人文无衬线（Source Sans 3 + Noto Sans SC）、舒适偏松密度；暗色同步为暖炭灰配套。旧蓝科技风与纸卡叠层默认主题直接替换，不保留兼容开关。
2. **Design Tokens**（字号阶梯、控件高度、间距、圆角、`--chat-max-width`）为结构约定，全站强制，管理员不可改。
3. **Brand Theme** 仅允许覆盖品牌色相关 CSS 变量：`brand_primary`、`brand_primary_foreground`、`brand_background`、`brand_surface`、`brand_foreground`、`brand_muted_foreground`（存储为 `#RRGGBB`，空值表示使用默认主题）；布局气质跟 Claude，色板仍服从 Brand Theme。
4. 公开 `GET /settings/branding` 返回文字品牌与 Brand Theme；客户端 `BrandThemeInjector` 写入根节点 CSS 变量。Android 客户端本轮不纳入。
5. 对话流采用 Conversation Stream：助手通栏正文、用户轻量淡底块、工具/思考低调折叠；composer 为大圆角底部固定壳。
