# 模型选择器与过程展示验收

日期：2026-11-14。实现目标：已批准Figma稿的Web选择器与CoT过程区；不含Android或生产部署。

## 交付

- 选择器：单一搜索、扁平列表、模型名与供应商、当前选择标识；同名跨连接独立。保留空目录刷新、错误重试、禁用、加载及键盘行为。
- 过程区：完成态一行状态/耗时；运行态真实活动；普通展开7步，再按需查看更多；原始思考与工具详情继续可达。
- 失败入口定位并展开首个失败节点及组内失败项，error/rejected/aborted口径一致。更多后焦点迁移到首个新增步骤；级别、披露步数、单步详情按消息恢复。
- 复用现有语义tokens、Radix组件和公开props；删除只服务旧选择器的分组、常用网格和能力徽章组件。无后端或数据库迁移。

## 自动检查

最终工作目录 packages/frontend，执行本项目脚本对应CLI（Windows中pnpm exec曾出现命令解析问题，使用已安装的同一入口）：

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=dot
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

- Vitest：134/134文件，759/759项通过，exit0，171.26秒。
- TypeScript：exit0，无类型错误。
- Next lint：exit0，无错误；保留仓库既有max-lines、img及依赖提示等非阻断警告。
- 初轮完整检查8项失败：6项与旧UI选择器/空目录恢复相关，现已修正；2项设置页动态加载在高并发下超时，单文件6项通过，设置页未修改；最终限2workers完整通过。
- 定向TDD：picker及调用方25项通过；CoT/原时间线/share39项通过。最初失败测试与审查回归均由对应实现者记录并验证。
- Standards与Spec两位独立审查者：全部发现闭环，无遗留明确缺陷。

运行日志：output/playwright/frontend-test.log、frontend-typecheck.log、frontend-lint.log。

## 浏览器验收

使用项目Next dev服务，真实隔离Chromium，桌面1440×1000及手机375×812。开发预览位于 /dev/redesign-preview，生产模式返回notFound。预览使用显式fixtures与真实ModelSelector/CotTimeline，不发送付费模型请求。

- 选择器：名称/供应商搜索、无结果清空、同名跨连接选择、方向键/Enter、Esc焦点回退、加载、空目录刷新、已有模型错误重试、禁用、深色、超长名称。
- 过程区：完成摘要、真实耗时读屏名称、初始7步、更多后第8步焦点、单步详情、刷新重挂载恢复、失败定位及组内详情、运行转完成保持用户选择。
- 视觉：宽窄屏排版、选中/聚焦、长文本、层叠及滚动检查完成；无水平溢出。
- 最终final-picker.json及final-process.json：pageerror为0，HTTP4xx/5xx为0，picker控制台error/warning为0。
- 启动时前端代理默认8001与本地后端3001不一致，已通过本次启动参数对齐；未修改项目代理配置。重启编译窗口出现过一次临时SyntaxError；编译完成后的诊断及最终两组运行均无该错误。
- 历史/分享/Battle保持原调用入口与数据；已通过对应组件回归与独立Spec核查，未执行线上真实账号会话或生产部署。

## 最终截图

- output/playwright/final-desktop-picker.png：桌面选择器，供应商去重、当前选择与搜索焦点。
- output/playwright/final-desktop-summary.png：完成态一行摘要。
- output/playwright/final-desktop-process.png：普通展开首屏7步。
- output/playwright/final-mobile-picker.png：375px底部Sheet。
- output/playwright/final-mobile-long-model.png：长模型名及连接名。
- output/playwright/final-mobile-failure-detail.png：失败定位、焦点及真实详情。
- output/playwright/final-mobile-running.png：真实运行活动。
- output/playwright/final-dark-picker.png、final-empty-recovery.png：深色和空目录恢复。

## 使用与保留事项

正常启动项目后使用原聊天入口即可；开发预览用于重现状态，不向生产开放。用户已授权提交并推送到main触发CI；本地验收不替代GitHub Actions最终结果。上述output目录为本地验收产物，批准的Figma设计稿保留在.figma/assets目录。
