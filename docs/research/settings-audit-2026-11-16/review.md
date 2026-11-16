# 设置精简最终审查

审查基线：`bb376960f6455f808fd4f428671f7f4062b73090`（`git merge-base origin/main HEAD`，实施前固定）。对象为 `settings-simplification` 的实际工作树差异，包含新增文件。Standards 与 Spec 由两个独立审查代理并行完成，修复后各自只读复核；测试与真实页面证据由实施负责人统一取得。

## Standards：已收口

| 发现 | 最终处理与证据 |
| --- | --- |
| 部署说明保留废弃 idle 键，超时默认与运行不符 | 后端 README 删除废弃键，默认统一为 120000ms；设置读取、聊天构造和压缩均复用 resolveStreamConfig。默认、数据库优先、环境回退有回归。 |
| 知识库策略的布尔解析不同源 | 策略门与设置 GET 共用 parseBooleanSetting，1/0、yes/no、y/n、on/off 与 true/false 同义；服务与 HTTP 回归覆盖。 |
| 搜索数值边界多份声明、resultLimit 解码缺夹取 | WEB_SEARCH_RANGES 是 API、codec、前端共同契约，resultLimit 夹取至 1..10，非法数字回落 4；共享契约回归覆盖。 |
| 搜索引擎归一化重复 | 设置 GET、迁移、codec、前端复用 normalizeWebSearchEngines；旧私有解析器删除，数组/JSON/CSV/换行、去重保序、空集合回退均有回归。 |
| 页面可选 scholar，API 枚举漏项 | API 直接使用 WEB_SEARCH_SCOPE_IDS；HTTP 保存 scholar 先复现 400，再验证 200。 |

本轮保留历史迁移键的字面量；迁移必须识别已从当前契约移除的键。未扩展 provider 分支重构。

## Spec：已收口

| 发现 | 最终行为与证据 |
| --- | --- |
| 旧 KB=true / RAG=false 被模式合并解释为关闭 | 优先解析为知识库模式，保留知识库开启值；页面明示保存将补开文档解析依赖。页面回归验证 payload 两项均为 true，缺 Embedding 模型时禁止保存。 |
| 自动生成上限误用上下文总量 | 未解析到输出上限时，OpenAI 系省略 max_tokens；Anthropic 使用 min(4096, contextRemaining)，满足协议必填要求。显式值继续优先并受剩余上下文约束。 |
| 旧包 session 导入静默转成已配置 bearer | 导入、合并、导出保留 session 标记；视图显示待配置，目录刷新跳过，聊天提示重新配置。旧凭据不作为 Bearer 发送。 |
| 提示词优先级文案错误 | 页头、卡副标题、卡内说明统一为会话 > 全局 > 内置默认；个人偏好独立追加。断言与最终截图对应。 |

回答版本与历史用量保留、保留期 0、失败保存、原子迁移与幂等性、知识库聊天权限、覆写域隔离及旧设置入口的运行证据，统一收录于实施记录。

两个轴最终均无剩余阻断项。上述结论是代码及测试文件的独立复核；实际运行结果见[实施记录](implementation.md)，页面结果见[浏览器验收](browser-acceptance.md)。
