# 扩展使用指南

想让 AI 使用新的外部工具时，可以安装 MCP 服务；想复用一套任务指引或执行流程时，可以安装 Skill。管理员在“系统设置 → 工具与扩展”集中管理，聊天工具面板选择本轮要使用的能力。

## 在聊天里安装扩展

将扩展的 GitHub 仓库链接发给模型，例如：

> 帮我安装这个扩展：[粘贴 GitHub 仓库链接]

启用 AI 自助安装后，模型调用 `install_extension`。服务端读取仓库内受支持的清单来判断类型：

| 仓库声明 | 安装结果 |
| --- | --- |
| 包含 `SKILL.md` | 安装 Skill 版本，沿用许可证和审批流程。 |
| 声明远程 MCP 端点 | 建立 MCP 安装模板与远程连接。 |
| 声明本地 MCP 启动命令 | 交由容器网关运行本地包 MCP。 |
| 同时有 MCP 和 Skill | 返回候选，确认类型后再安装。 |

安装器只读取少量白名单清单，如 `SKILL.md`、`server.json`、`mcp.json`、`package.json` 和 `README.md`。完成 MCP 安装后会实际握手并请求 `tools/list`，返回工具清单或尚缺的配置。

## 填写连接密钥

进入“系统设置 → 工具与扩展 → MCP 服务 → 连接”，编辑目标连接。表单按照安装声明的名称显示密钥输入框；填写并保存后进入 Secret Vault，工具清单随之刷新。

管理员可在安装模板的“必需环境变量”中声明所需名称。模型接收缺失密钥的名称，密钥值在设置页填写。

## 权限与运行条件

- MCP 安装模板是系统资产，由管理员创建。普通用户可基于已安装模板建立自己的连接。
- 第三方 Skill 沿用平台的审批、能力声明和会话绑定流程；可执行型 Skill 在沙箱中运行。
- 本地包 MCP 在 Docker 容器网关运行。Docker 或网关不可用时，先恢复该运行依赖，再验证工具清单。
- 远程 MCP 需要服务端能访问目标端点，并满足该端点的认证要求。
- “工具与扩展”页头的“AI 自助安装”开关控制 `install_extension` 是否可用，默认开启。

## 容器网关参数

下面是服务端运行时支持的变量。默认 Compose 只显式传递其中一部分环境变量；要调整未列入编排的参数，在 `app.environment` 中增加对应项。仅写进 Compose 的 `.env` 不会自动传入容器。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MCP_GATEWAY_NODE_IMAGE` | `node:20-slim` | `npx` 型本地包运行镜像。 |
| `MCP_GATEWAY_PYTHON_IMAGE` | `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` | `uvx` 型本地包运行镜像，需含 uv。 |
| `MCP_GATEWAY_CPUS` | `0.5` | 单容器 CPU 限额。 |
| `MCP_GATEWAY_MEMORY` | `512m` | 单容器内存限额。 |
| `MCP_GATEWAY_PIDS_LIMIT` | `128` | 单容器进程上限。 |
| `MCP_GATEWAY_NETWORK` | `bridge` | 容器网络模式；`none` 表示断网。 |
| `MCP_RUNTIME_TIMEOUT_MS` | `30000` | MCP 握手与调用超时，毫秒。 |
| `EXTENSION_INSTALL_TOOL_ENABLE` | 跟随系统设置 | 环境变量兜底开关，系统设置优先。 |

## 相关文档

- [README：首次配置](../README.md#首次配置)
- [部署指南](DEPLOYMENT.md)
- [MCP 运行层与容器网关](adr/0037-mcp-runtime-client-and-container-gateway.md)
- [AI 自助安装设计](adr/0038-extension-install-is-a-model-tool.md)
