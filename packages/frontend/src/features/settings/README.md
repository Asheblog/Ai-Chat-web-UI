# Settings Feature

该目录承载与系统设置相关的领域模块，遵循“features/<domain>”的切分方式：

- `pages/system-general`：后台通用设置页面与弹窗共用的客户端组件，内聚注册、配额、品牌等表单逻辑。
- `pages/system-models`：模型覆写/能力开关面板及批量操作逻辑，依赖 `useSystemModels` 服务钩子。

新的页面组件应尽量保持无状态（依赖特定 hook 获取数据），以便同时在路由页面与 Dialog 中复用。 README 持续更新以指导后续拆分。
