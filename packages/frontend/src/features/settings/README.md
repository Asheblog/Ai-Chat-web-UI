# Settings Feature

该目录承载与系统设置相关的领域模块，遵循“features/<domain>”的切分方式：

- `pages/system-models`：模型覆写/能力开关面板及批量操作逻辑，依赖 `useSystemModels` 服务钩子（旧 `pages/system-general` 已并入 `components/settings/pages` 下的 branding/users-registration/tools-extensions/data-maintenance 四页）。

## 系统设置导航

系统设置采用左侧三级导航：一级为 `个人设置` / `系统设置`，二级为系统设置工作域，三级为具体设置页面。右侧内容区只渲染当前三级页面，不再承载模块切换 tab。

系统设置工作域（`systemSettingsTree`，12 个叶子）的推荐分组：

- `概览`：概览。
- `模型与连接`：供应商与连接、模型管理。
- `功能与工具`：搜索与知识库、工具与扩展、MCP 管理。
- `成员与安全`：用户与注册、Skill 治理。
- `系统与数据`：品牌与界面、日志与审计、数据与维护。
- `高级设置`：推理与网络。

新的页面组件应尽量保持无状态（依赖特定 hook 获取数据），以便同时在路由页面与 Dialog 中复用。 README 持续更新以指导后续拆分。
