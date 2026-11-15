# Model Selector 组件说明

## 交互契约
- 搜索加单列模型列表。每个模型只出现一次，模型名在上、连接显示名与供应商在下，当前选择用右侧勾选标记。
- 供应商来自真实连接元数据，不按模型名称猜测；连接显示名优先，保留同名模型的消歧信息。连接显示名与供应商相同（忽略大小写）时仅显示一次。
- 不提供系列侧栏、收藏、最近、能力筛选、常用区或能力/上下文徽章，也不再读写旧选择器偏好缓存。
- 搜索覆盖模型名、模型 ID、连接显示名和供应商，忽略首尾空白与大小写；空搜索保留 store 提供的目录顺序。
- 选择回传原始 ModelItem，身份仍是 connectionId:rawId；不改变调用方、store 或后端的可用性约束。

## 组合模式：模型与思考强度
- 传入 `reasoningControl` 后启用组合模式：触发器同时显示模型名与当前强度（如 `DeepSeek V4.1 Flash Max`），`unset` 显示“默认”。
- 强度六值沿用设置语义：`unset | low | medium | high | max | xhigh`。组件不保存强度，也不写默认值或示例值；值全部来自 `reasoningControl.value`。
- 同一面板内两个视图。模型列表底部固定“思考强度（当前值）”入口，进入后标题变“思考强度”、左侧返回、当前模型名作为上下文行；选择后回传 `onChange` 并回到模型列表。
- 组合模式选择模型后保留面板以便继续调整强度；未提供 `reasoningControl` 的旧调用仍然是选择即关闭。
- 深度思考开关独立表达开关状态，不在选择器内重复。

## 可选受控接口
- `open` / `onOpenChange`：受控展开。提供 `open` 时组件不再自持展开状态，仍会上报关闭意图，便于“思考”等入口直达强度页。
- `defaultView: 'models' | 'effort'`：每次展开时进入的视图。标签直达强度页时传 `effort`，关闭后由调用方复位为 `models`。
- `formatTriggerName?: (name: string) => string`：只影响触发器可见文本的短名规则（手机使用）。完整名称始终保留在 `title`、列表与可访问描述中；不能可靠缩短的名称原样返回并截断。
- 旧调用不传上述三项即可编译运行，契约与关闭行为不变；`ComposerModelActions` 的同名可选属性原样透传。

## 目录结构
- model-selector-panel.tsx：公开组件编排；桌面 Popover，767px 及以下使用底部 Sheet。
- use-model-selector.ts：目录、搜索、视图与覆盖层状态；Radix 生命周期内的搜索聚焦与触发器焦点回退。
- model-selector-utils.ts：精确连接身份匹配、搜索与触发器短名的纯函数。
- model-selector-trigger.tsx：大小、inline 与禁用契约的触发按钮；组合模式输出模型+强度，并向读屏描述完整身份。
- model-selector-header.tsx：标题、关闭动作、强度视图返回及真实错误状态中的重试。
- model-selector-search-controls.tsx：搜索输入与清空动作。
- model-selector-effort.tsx：六值选项、文案表、列表底部入口与强度列表。
- model-selector-list.tsx / model-selector-row.tsx：加载、空目录、无结果及扁平列表；长名称完整换行并增加行高，完整文本同时保留在 title 与可访问名称中。
- model-selector-keyboard.ts：上下键、Home / End 与 Enter；输入法组合期间不触发选择。
- model-selector-types.ts：公开类型；`@/components/model-selector` 统一再导出组件、类型与 `formatModelShortName`。

## 状态与可访问性
- 可访问名保持“选择模型”。组合模式额外用 `aria-describedby` 指向 sr-only 描述，读屏可听到当前完整模型身份与强度；非组合调用没有这项依赖。
- 默认聚焦搜索；上下键移动到模型，Enter / Space 使用原生按钮选择，Esc 或关闭动作返回触发器。
- 加载、成功空目录、搜索无结果和请求失败分开呈现；成功空目录提供刷新，加载时防止重复请求。失败时保留已加载模型，重试仅出现在错误状态。
- 桌面列表只有一个滚动区；手机保留底部安全区域，模型行与动作至少 44px 触控高度。
- 沿用 globals.css 语义 tokens 与公共覆盖层组件，不引入品牌色值。

## 验证与迁移
- 目标测试：pnpm --filter @aichat/frontend exec vitest run src/components/model-selector
- 交互测试使用真实 Zustand store、Radix 覆盖层和模型行；供应商 API 不参与测试。
- 无迁移、直接替换。旧调用（Battle 配置与重审、dev 预览、欢迎页、双端输入区）不需要提供组合或受控属性，选择即关闭的行为保留。
