# Model Selector 组件说明

## 目标
- 将模型选择器拆分为「状态编排层 + 纯逻辑层 + 视图子组件」，降低单文件复杂度。
- 统一搜索、筛选、常用模型、分组列表的职责边界，方便后续迭代 UI。

## 目录结构
- `model-selector-panel.tsx`：主组件，负责状态管理、事件编排、子组件组合。
- `model-selector-types.ts`：公共类型、常量、筛选配置。
- `model-selector-utils.ts`：纯函数工具（分组、排序、筛选、格式化）。
- `model-selector-trigger.tsx`：触发按钮（闭合态 UI）。
- `model-selector-search-controls.tsx`：搜索框与筛选项区域。
- `model-selector-quick-grid.tsx`：常用模型快捷卡片区域。
- `model-selector-group-list.tsx`：供应商分组列表与模型项渲染。
- `model-selector-capability-badges.tsx`：能力徽章展示。

## 数据流（简版）
1. `model-selector-panel.tsx` 从 store 拉取模型列表与 loading 状态。
2. 面板状态（搜索词/视图/能力筛选/收藏/最近使用）汇总后传入 `buildModelCollections`。
3. `buildModelCollections` 返回：
   - `groupedModels`（用于分组列表）
   - `quickModels`（用于常用区）
   - `favoriteModelKeys`（用于星标状态）
   - `visibleCount`（用于计数展示）
4. 主组件将数据分发给各子组件渲染。

## 扩展建议
- 新增筛选维度时：优先在 `model-selector-types.ts` 增加枚举与配置，再在 `model-selector-utils.ts` 落地过滤逻辑。
- 调整排序策略时：只改 `buildModelCollections` 内的 `scoreModel` / `sortModels`。
- 调整显示样式时：优先改对应视图子组件，避免把样式回灌到 `panel`。

## 兼容与迁移
- 本次为**无迁移、直接替换**。
- 对外 API 保持不变：`packages/frontend/src/components/model-selector.tsx` 仍导出 `ModelSelector`。
