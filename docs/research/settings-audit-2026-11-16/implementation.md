# 设置精简实施与升级

基线：main bb376960。实施分支：settings-simplification。

用户接受审计方案，并明确删除“单条消息 AI 回答上限”。回答版本全部保留，重新生成和切换版本继续使用原入口；系统不再根据数量删除消息或用量记录。升级无需清空聊天数据。

## 实施范围

- 修复图片与匿名会话保留天数 0 的永久保留语义、设置失败反馈、安装工具开关读写、知识库功能与角色访问控制、追踪事件下限和运行默认值。
- 删除死配置，归并搜索引擎启用与排序、双语开关与模式；配置原子迁移在接受请求前完成。
- 按模型能力处理生成参数，分离能力、访问和参数覆写，重置只影响指定域。
- 系统设置组织为概览与六组：连接与模型、搜索与知识库、工具与扩展、用户与访问、数据与日志、外观与站点。原设置叶子 key 映射保留，新增会话默认配置。
- 高级生成、传输、推理兼容、品牌配色、搜索执行参数折叠；保留有效的压缩、工具、权限及数据保留能力。

## 测试接缝与验收

使用项目现有服务与 API，以及页面可见操作验证：永久保留、重新生成与版本切换、用量记录保留、设置保存错误、旧配置升级、知识库策略、模型参数构造与局部重置。使用独立 SQLite 数据库验证迁移，真实本地 dev server 与浏览器检查宽窄屏及关键状态；不使用生产数据。

Standards / Spec 两路独立审查按固定 merge-base 检查实际工作树差异，修复后分别复核。相关类型检查、项目测试、架构检查、真实页面验收和生产构建完成后，提交分支、合并 main 并推送 origin。

## 配置迁移

启动前的 settings-simplification 迁移在单一事务中执行一次，并写入 settings_simplification_20261116 标记：

- web_search_engine_order 中属于启用集合的引擎排在前面；其余启用引擎按原相对顺序追加，结果写回 web_search_enabled_engines。
- web_search_auto_bilingual=false 转换为 web_search_auto_bilingual_mode=off；为 true 时保留已有模式。
- 删除 assistant_reply_history_limit、provider_max_idle_ms、三个 python_tool_* 旧执行限制，以及 web_search_engine_order、web_search_auto_bilingual、web_search_parallel_merge_strategy。
- 未配置生成上限时为 0（自动）；显式配置的旧上限保持原意。

旧环境变量中的排序和双语关闭值只在首次升级时参与迁移；之后以新配置为准。模型连接类型不再作为产品选项，底层列留存为存储结构；旧 session 认证在存量行、导入、导出及合并中保留待配置标记，需在连接编辑器重新选择认证方式。

文档模式合并时，旧 knowledgeBaseEnabled=true / ragEnabled=false 组合仍显示为知识库模式；页面说明保存会补开文档解析依赖，知识库保持开启。自动生成上限按模型人工值、已知模型表、显式系统值、协议自动值解析；没有已知上限时 OpenAI 系省略 max_tokens，Anthropic 使用保守 4096 并按剩余上下文收敛。

## 交付证据

2026-11-16，在当前工作树依赖下完成以下原生命令检查：

| 检查 | 结果 |
| --- | --- |
| shared build | 通过 |
| 后端 Jest 全量（--runInBand） | 207 suites / 1460 tests 通过；1 suite / 2 tests 为既有跳过 |
| 学术搜索范围 HTTP 回归（全量后追加修复） | 先复现 400，修复后 6 tests 通过；后端 type-check 再次通过 |
| 前端 Vitest 全量（--maxWorkers=2） | 176 files / 1157 tests 通过 |
| backend / frontend / mobile type-check | 全部通过 |
| mobile test | 8 tests 通过 |
| architecture:check | 通过，4 package sources，无循环 |
| 后端 esbuild 双入口 | 通过，index 与 document-worker 及 sourcemap；复制运行所需 seccomp 资源 |

完整回归包含：所有回答版本与用量保留、图片与匿名保留期 0、活跃匿名会话排除、迁移幂等性及存量值保留、设置 HTTP/store 失败路径、知识库访问策略、模型覆写域、参数适配、旧认证导入导出、设置导航及滚动、自动生成上限和长内容。

运行环境的 pnpm 注入会产生 UNDICI-EHPA 实验性提示；全量后端以 NODE_NO_WARNINGS=1 隔离其对子进程 stderr 断言的影响。未改产品逻辑或测试断言来绕过失败。工作树原有 node_modules 链接指向另一检出，已在本工作树改成独立目录并把 @aichat/shared 指向本分支；上述最终全量结果均在纠正后取得。

- [独立审查记录](review.md)：Standards 与 Spec 两轴的发现、修复和最终结论。
- [真实浏览器验收](browser-acceptance.md)：11 个系统叶子与个人偏好，1440 / 390 视口，以及加载、错误、空态、焦点、禁用、长内容、保存失败、自动上限和搜索定位。

前端 Next.js 15.5.29 生产构建通过，静态页面 13/13 生成成功，完成页面优化和 build traces。构建仍报告现有 ESLint 长文件/长函数及部分 Hook 建议；显式 frontend type-check 已独立通过（项目 Next 配置跳过内建类型阻断）。页面交互验收使用真实 dev 服务和隔离数据库，未在生产构建产物上重跑交互。

Git 交付方式：在 settings-simplification 分支提交实施与证据，再合并到 main 并推送 origin；实际提交与合并哈希以 Git 历史及最终交付回执为准。
