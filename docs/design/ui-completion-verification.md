# Ink & Mist v2 验证与交付

日期：2026-11-14。审查基线：`2d73504bbc378124a8a9d0a3bb207595c822b8ef`。

## 交付范围

六页Figma（设计系统、聊天、设置、组件与状态、认证与分享、对战与日志）与对应前端。输入区桌面会话760px、Welcome720px，左侧工具独立滚动，模型与发送靠右；手机两行、44px触控。模型家族分组、跨连接复合键、收藏/搜索/键盘、空错刷新恢复。设置保留真实hash/权限与各页原有保存方式，日志保留旧结果并正确重试失败页。

Figma任务节点：组件板21:2、暗色选择器22:663、暗色输入22:933、设置细节22:302、分享22:893/22:913。设计参考当前未绑定；以上为本任务明确创建与核验的交付节点，不沿用失效参考。

## 检查结果

- 前端最终完整回归：133文件、740测试通过（maxWorkers=2，exit0）。首轮有12项失败；修正尺寸断言、限制并发资源后完整回归通过。首次失败记录保留，不作为通过证据。
- 最终前端type-check：恢复测试fixture补齐类型后通过。
- 架构检查：4个package source、无环、API层db-free。shared构建通过。
- 独立Standards/Spec审查：3项实际缺陷已修复，未发现额外独立P1/P2。
- 前端生产构建：Next.js 15.5.29，18个路由，exit0。完整类型检查另行通过（项目build配置跳过内嵌类型检查）。
- 发布门禁：主分支对应提交的 `Build and Push Images`，包含架构/跨包回归、Frontend Image、Backend Image、All-in-One Image；远端结论以该提交Actions记录为准。

## 修复证据

| 问题 | 修复与验证 |
|---|---|
| Welcome空目录/首次失败时模型入口被禁用 | 浏览模型只按isCreating禁用；发送creationDisabled保持；3项红→绿测试，1440/390/320空错显式刷新6run通过 |
| 日志失败后next/prev跳过失败页 | 翻页基准使用显示result.page；失败query保留供retry；3项新增红→绿，日志7项通过 |
| 日志与安全页手机控件不足44px | 移动44、桌面保持原密度；尺寸回归与实图 |
| 双focus/输入区过宽/侧栏层级/选择器重阴影 | 单信号边框、760/720限宽、顶部只新建、共享轻阴影；实图检查 |
| 分享截图显示Markdown源码 | 诊断确认worker异步初始化，成熟生产渲染链路正常；修验收ready为h2/code/table齐全且无pending/fallback，不改生产代码 |

## 浏览器证据

运行真实Next dev与Chromium，API用显式DTO fixture；SSR分享仅本地只读fixture服务，不发付费模型请求。使用真实中文、长模型名、同名跨连接、代码/表格/长链接。

- 系统十叶：概览/连接/模型/搜索知识库/能力扩展/用户管理/品牌/审计/维护/推理网络，1440/390/320明暗均等待真实标题和表单，而非骨架。
- 聊天：真实消息、工具时间线、代码表格；右对齐、限宽、单focus、手机横向工具；模型空错刷新恢复。
- 日志：真实记录、上下文JSON、首错重试、stale失败保留、筛选；追踪详情request/tool/response三事件。
- 对战：桌面/320宽完成参赛模型与裁判选择、进入题目并填充两字段。公开分享320dark等到全部Markdown无pending/fallback，且标题/代码/表格实际生成。
- 已归档代表图：[桌面聊天](assets/ui-v2/browser/chat-desktop.png)、[320暗色Welcome](assets/ui-v2/browser/welcome-mobile-dark.png)、[设置概览](assets/ui-v2/browser/settings-overview.png)、[日志上下文](assets/ui-v2/browser/logs-context.png)、[手机追踪](assets/ui-v2/browser/trace-mobile.png)、[手机安全表单](assets/ui-v2/browser/security-mobile.png)、[桌面对战题目](assets/ui-v2/browser/battle-desktop.png)、[手机暗色富文本分享](assets/ui-v2/browser/share-mobile-dark.png)。
- 分享分页：本轮SSR共4条已全量显示，无“加载更多”可点击；接口includeMessages=0与limit2分页自测通过，未把接口自测记为UI分页点击。
- 旧system导航截图及折叠安全卡不计完成；旧share纯文本截图是异步中间态，不计最终富文本。完整原始运行保留本地output/playwright/ui-v2。

## 适用边界

登录/注册与对战入口/结果页本轮有效实屏为390light，最新分享富文本为320dark；未宣称这些页面全三宽矩阵。手机会话旧padding31px测量锚点有误并已撤销，未取得更正后最终数值；实图布局审阅有效。

界面与交互以DTO fixture验证，真实后端持久化、外部模型执行和部署后的在线连通性未运行；保存函数/API、username认证、Battle pass@k、分享只读分页原有语义保留，并由定向回归/静态审查覆盖。
