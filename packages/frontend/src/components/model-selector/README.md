# Model Selector 组件说明

## 交互契约
- 搜索加单列模型列表。每个模型只出现一次，模型名在上、连接显示名与供应商在下，当前选择用右侧勾选标记。
- 供应商来自真实连接元数据，不按模型名称猜测；连接显示名优先，保留同名模型的消歧信息。连接显示名与供应商相同（忽略大小写）时仅显示一次。
- 不提供系列侧栏、收藏、最近、能力筛选、常用区或能力/上下文徽章，也不再读写旧选择器偏好缓存。
- 搜索覆盖模型名、模型 ID、连接显示名和供应商，忽略首尾空白与大小写；空搜索保留 store 提供的目录顺序。
- 选择回传原始 ModelItem，身份仍是 connectionId:rawId；不改变调用方、store 或后端的可用性约束。

## 目录结构
- model-selector-panel.tsx：公开组件编排；桌面 Popover，767px 及以下使用底部 Sheet。
- use-model-selector.ts：目录、搜索与覆盖层状态；Radix 生命周期内的搜索聚焦与触发器焦点回退。
- model-selector-utils.ts：精确连接身份匹配与搜索纯函数。
- model-selector-trigger.tsx：原有大小、inline 及禁用契约的触发按钮。
- model-selector-header.tsx：标题、关闭动作及真实错误状态中的重试。
- model-selector-search-controls.tsx：搜索输入与清空动作。
- model-selector-list.tsx / model-selector-row.tsx：加载、空目录、无结果及扁平列表；长名称最多两行，完整文本保留在 title 与可访问名称中。
- model-selector-keyboard.ts：上下键、Home / End 与 Enter；输入法组合期间不触发选择。

## 状态与可访问性
- 默认聚焦搜索；上下键移动到模型，Enter / Space 使用原生按钮选择，Esc 或关闭动作返回触发器。
- 加载、成功空目录、搜索无结果和请求失败分开呈现；成功空目录提供刷新，加载时防止重复请求。失败时保留已加载模型，重试仅出现在错误状态。
- 桌面列表只有一个滚动区；手机保留底部安全区域，模型行和动作至少 44px 触控高度。
- 沿用 globals.css 语义 tokens 与公共覆盖层组件，不引入品牌色值。

## 验证与迁移
- 目标测试：pnpm --filter @aichat/frontend test --run src/components/model-selector
- 交互测试使用真实 Zustand store、Radix 覆盖层和模型行；供应商 API 不参与测试。
- 无迁移、直接替换。公开包装器及 ModelSelectorProps 保持不变。
