# 扩展安装工具（AI 自助安装 MCP / Skill）设计

> 状态：已实现（2026-11-12）。实现与原设计的偏差见文末「实现落点」。

## 1. 问题

现在安装扩展要人去 设置 → 能力扩展 → MCP 服务 里手填 8 个技术字段，或者去 Skill 段贴一条带 `@ref:subdir` 的规范源。

目标是反过来：**用户把一条 GitHub 链接丢给 AI，AI 自己判断这是什么、该怎么跑、缺什么密钥，直接装好并启用。** 安装能力本身必须是模型可调用的工具，而不是页面上的表单。

## 2. 决定性约束（现状核查）

| 事实 | 证据 | 后果 |
|---|---|---|
| MCP 只有数据模型和配置界面，没有运行时 | `app-container.ts:329` 未注入 `runtimeClient`；`mcp-service.ts:282`/`:447` 直接抛「Runtime Client 未配置」；全仓无 `@modelcontextprotocol/*` 依赖 | MCP 装完也调不通，工具必须如实返回 `registered_unverified`，不能假装成功 |
| 本地包型 MCP 被 ADR-0015 锁在沙箱网关里 | `docs/adr/0015-...`；改造前 `mcp-service.ts` 对 `local_package` 抛 501 | 由容器网关承载（`docker run -i` 受限容器）；宿主机 docker 不可用时才登记 `pending_gateway` |
| Skill 安装链路已完整 | `skill-installer.ts` `installFromGithub()`；`POST /api/skills/install` | 工具可以直接复用，Phase 1 就能端到端跑通 |
| 工具层有完整扩展点 | `tool-handler-types.ts:80` `IToolHandler`；`registry.ts:193` 工厂；`agent-web-search-response.ts:665` 装配点 | 加工具不需要改编排器 |
| 会话上下文已带身份 | `ToolCallContext.actorUserId` / `actorIdentifier` / `sendToolEvent` | 权限判定与安装进度渲染都有现成通道 |

## 3. 工具契约

工具名 `install_extension`（单工具、服务端判定类型，避免让模型先做分类）。

```ts
parameters: {
  source: string        // GitHub URL / owner/repo@ref:subdir / github.com/.../tree|blob/...
  kind?: 'auto' | 'mcp' | 'skill'   // 默认 auto
  scope?: 'user' | 'system'         // 缺省按角色：管理员 system，其余 user；system 仅管理员
  enable?: boolean                  // 默认 true
}
```

description 必须写清触发条件：用户给出 MCP/Skill 的仓库链接、要求「安装/接入某个服务或技能」、要求「给我加个 xx 能力」时调用；不要凭猜测调用。

返回（工具消息内容，JSON）：

```json
{
  "ok": true,
  "detected": { "kind": "mcp", "transport": "streamable_http", "name": "github-mcp", "source": { "owner": "x", "repo": "y", "ref": "main", "subdir": null }, "confidence": "high" },
  "installed": { "installationId": 12, "connectionId": 34, "skillId": null, "versionId": null },
  "status": "needs_secret",
  "tools": [{ "name": "create_issue", "description": "..." }],
  "requiredSecrets": [{ "name": "GITHUB_TOKEN", "reason": "README 声明的访问令牌" }],
  "nextSteps": ["在「凭据」里填入 GITHUB_TOKEN 后可调用 3 个工具"],
  "warnings": ["本地包型需 MCP 网关，当前未启用"]
}
```

`status` 五态：`ready` / `needs_secret` / `pending_approval`（Skill 高风险待审批）/ `pending_gateway`（本地包）/ `registered_unverified`（MCP 运行时不可用，已登记未验证）。

进度通过 `context.sendToolEvent` 发 `start → progress(probe/install/verify) → end|error`，复用现有工具事件渲染，不新增卡片组件。

## 4. 识别层：Resolve → Probe → Plan

```
source ──parse──▶ {owner, repo, ref, subdir?}
                     │
                     ▼ GitHub API 只取需要的文件（contents/raw，带 token，缓存 10min）
        package.json · SKILL.md · server.json · mcp.json · smithery.yaml · README.md · pyproject.toml
                     │
                     ▼ 判定表
                 InstallPlan
```

| 条件 | 判定 | Plan 关键字段 |
|---|---|---|
| 目录有 `SKILL.md`（含 YAML frontmatter） | Skill | `kind=skill`, `subdir` |
| 有 `server.json` / `mcp.json` / `smithery.yaml` | MCP，读它声明 | `transport`, `command`, `args`, `envKeys`, `endpoint` |
| `package.json` 有 `bin` 且依赖 `@modelcontextprotocol/sdk` | MCP 本地包（stdio） | `command=npx`, `args=['-y', pkg]` |
| README 命中 `npx -y <pkg>` / `uvx <pkg>` | MCP 本地包 | 同上 |
| README 出现 `https://…/mcp` 或 `mcp-remote <url>` | MCP 远程 | `transport=streamable_http`, `endpoint` |
| 同时命中 Skill 与 MCP | ambiguous | 返回 `candidates`，由模型追问用户 |
| 全不命中 | 不安装 | 返回缺什么（缺 manifest / 缺 SKILL.md / README 无安装段） |

`envKeys` 只收集**名称与用途**，永不读取或回传密钥值。

## 5. 安装层：两条路径，复用现有 service

**Skill**：`skillInstaller.installFromGithub({ source, actorUserId, token })` → 已有版本状态机（`resolveVersionStatusByRisk`）与许可证判定；高风险落 `pending_approval`。启用走既有 session/user skill binding。

**MCP**：
1. `createInstallation({ namespaceKey, name, sourceType, transport, endpoint|command+argsJson, envJson, sourceUrl, registrySource })`，`namespaceKey` 由 `owner/repo#subdir` 归一出稳定值，已存在则复用（幂等）
2. `createConnection({ installationId, name, enabled, secretVaultId: null })`
3. `bindConnection({ connectionId, scopeType, scopeId, enabled })`
4. `refreshToolCache(connectionId)` → 有运行时则落 tool cache + 返回工具清单；无运行时落 `registered_unverified`
5. 可选 `pinTool` 前 N 个工具

任一步失败：`deleteConnection` + `deleteInstallation` 回滚，返回结构化错误，不留半装状态。

## 6. 权限与安全

- `actorUserId` 为空（匿名）→ `{ok:false, error:'需要登录后才能安装扩展'}`
- 非管理员：只能 `scope=user`，装成用户私有；`scope=system` 直接 403 并说明需要管理员
- 管理员：默认仍装 system（系统级模板），`scope=user` 时装私有
- 密钥不经工具参数传递；工具只返回 `requiredSecrets`，用户在「凭据」填写，落在 SecretVault
- 本地包型（stdio）不落地启动，一律 `pending_gateway`（ADR-0015）
- GitHub 私有仓库走 `GITHUB_SKILL_TOKEN`（已有环境变量）；无 token 时私有仓库识别失败要给出明确原因
- 每次安装写一条审计（沿用已有 tool event + 安装记录，不新建表）

## 7. 分阶段

**Phase 1 — 工具 + 识别 + Skill 全链路（可独立上线）**
`install_extension` 注册、判定表、Skill 安装到可用、MCP 登记到 `registered_unverified`/`pending_gateway`。
验收：聊天里贴一条 Skill 仓库链接 → AI 调工具 → 装好并在「版本 / 绑定」里出现；贴 MCP 仓库 → 安装模板 + 连接 + 绑定生成，工具清单为空且状态如实。

**Phase 2 — MCP 运行时（远程，已实现）**
新增 `mcp-runtime-client.ts`（自实现 JSON-RPC 2.0 + Streamable HTTP / HTTP+SSE，零新增依赖），注入 `app-container`。
验收：远程 MCP 装完 `status=ready` 且能真调通一个工具；`refresh-tools` 不再 500。

**Phase 3 — MCP Gateway（本地包，已实现）**
`docker run -i` 承载 stdio，复用 `DOCKER_HOST`（生产即 docker-socket-proxy），容器开启 cap-drop / no-new-privileges / pids·cpus·memory 限额，落实 ADR-0015。
验收：stdio 型装完 `status=ready`，进程跑在容器里而非宿主。

## 8. 文件影响面

**新建**
- `packages/backend/src/modules/extensions/types.ts`（InstallPlan / DetectResult / InstallOutcome）
- `.../source-parser.ts`（复用 `skill-github-fetcher.ts` 的 parse，扩展 repo 根 URL 与 README 直链）
- `.../repo-probe.ts`（GitHub contents/raw 拉取，token + 缓存 + 体积上限）
- `.../detector.ts`（判定表）
- `.../extension-installer.ts`（Skill / MCP 两条路径 + 回滚）
- `packages/backend/src/modules/chat/tool-handlers/install-extension-handler.ts`
- `packages/backend/src/services/mcp/mcp-runtime-client.ts`（Phase 2）

**修改**
- `tool-handlers/registry.ts`（按 config gate 注册）
- `agent-runtime/tool-handler-types.ts`（`ToolHandlerFactoryParams.extensionInstall`）
- `agent-runtime/agent-tool-config.ts`（`buildAgentExtensionInstallConfig`）
- `modules/chat/agent-web-search-response.ts:669`（装配；`mcpService`、`actorUserId` 已在该作用域内）
- `packages/shared/src/settings-contract.ts` + `settings-codec.ts`（新键 `extensionInstallToolEnable` → `extension_install_tool_enable`，默认 `true`）
- `container/app-container.ts:329`（Phase 2 注入运行时）
- `battle-executor.ts:585`：**不**开该工具（大乱斗里装扩展没有意义），显式保持关闭

**不动**：Prisma schema、现有设置页表单、`/api/mcp`、`/api/skills` 路由与载荷。

## 9. 明确不做

- 不做新的「扩展市场」页，不做设置页新表单
- 不让模型传明文密钥，不做浏览器 OAuth 授权流
- 首版不支持 npm 包名、PyPI、官方 registry、Smithery 作为 source（Phase 4 再说）
- 不做依赖预装 / venv 构建（Skill 运行时依赖仍走既有受管流程）

## 10. Review Focus

- **越权**：非管理员用 `scope=system`、匿名调用、Battle 路径、session 绑定到他人会话，四种都要 403 而非静默降级
- **幂等**：同一仓库重复安装必须复用 installation / 返回「已安装」而不是堆出重复模板
- **假成功**：MCP 在无运行时环境绝不能返回 `ready`；`registered_unverified` 必须带明确 `nextSteps`
- **回滚**：installation 建成功而 connection 失败时不留孤儿记录
- **工具名冲突**：`install_extension` 不得与 MCP 动态 `mcp_*` 前缀或既有工具重名
- **识别误判**：Skill 与 MCP 同时命中必须返回 ambiguous 让模型追问，不得默认选一个
- **大仓库**：repo-probe 只取白名单文件（≤10 个、单文件 ≤256KB、总量 ≤1MB），不得整包下载

---

## 11. 实现落点

### 后端

| 文件 | 职责 |
|---|---|
| `modules/extensions/source-parser.ts` | GitHub 链接与 `owner/repo@ref:subdir` 解析、namespaceKey 归一 |
| `modules/extensions/github-probe.ts` | 白名单文件探测（≤10 个文件、单文件 ≤256KB、总量 ≤1MB），带 token 与 10 分钟缓存 |
| `modules/extensions/detector.ts` | 判定表：SKILL.md / server.json / mcp.json / smithery.yaml / package.json / README |
| `modules/extensions/extension-installer.ts` | Skill 与 MCP 双路径、幂等、回滚、工具固定 |
| `modules/extensions/extension-install-service.ts` | 编排 + 权限判定（管理员 / 普通用户 / 匿名） |
| `modules/chat/tool-handlers/install-extension-handler.ts` | `install_extension` 工具：参数归一、进度事件、结果回填 |
| `services/mcp/mcp-runtime-client.ts` | `McpRuntimeClient` 实现：streamable_http / sse / stdio(容器) |
| `services/mcp/runtime/json-rpc.ts` | 最小 JSON-RPC 2.0 客户端 |
| `services/mcp/runtime/http-transport.ts` | Streamable HTTP（含 Mcp-Session-Id）与旧版 HTTP+SSE |
| `services/mcp/runtime/docker-stdio-transport.ts` | `docker run -i` 承载 stdio，cap-drop / no-new-privileges / 资源限额 |

### 与原设计的偏差

1. **权限按 ADR-0017 落地**：MCP 安装模板仍只有管理员能创建；普通用户拿到的是 `pending_approval` +「请管理员先安装该模板」。本地包型对普通用户直接 `pending_gateway`。
2. **工具激活条件**：不是常驻注册，而是消息里出现 GitHub 链接（`detectExtensionSourceInMessage`）时才把请求放进工具循环，避免普通聊天承担工具 schema 与多轮开销。
3. **网关镜像与配额走环境变量**：`MCP_GATEWAY_NODE_IMAGE`、`MCP_GATEWAY_PYTHON_IMAGE`、`MCP_GATEWAY_CPUS`、`MCP_GATEWAY_MEMORY`、`MCP_GATEWAY_PIDS_LIMIT`、`MCP_GATEWAY_NETWORK`；docker 不可用时如实返回 `pending_gateway`。
4. **设置开关**：`extension_install_tool_enable`（默认开启），落在能力扩展页头「AI 自助安装」。
5. **返回字段对齐 §3**：对外用 `detected` 描述判定结果（内部类型仍叫 `InstallPlan`），并补 `candidates` 供 ambiguous 时追问。
6. **多出两个状态**：`already_installed`（同仓库重复安装直接复用）与 `pending_validation`（Skill 版本待校验）；§3 的五态仍是主路径。
7. **默认范围按角色**：未显式传 `scope` 时，管理员装系统级模板（§6），普通用户装私有；显式传值永远优先。
8. **安装审计**：只复用工具事件与 `McpInstallation` / `McpConnection` / Skill 版本记录，不新增审计表（§6「沿用已有」）。
9. **仅 ACTIVE 用户可安装**：`PENDING` 状态账号直接拒绝，避免待审批账号通过工具绕过注册审批。
10. **额外识别 `docker run`**：README 里以 `docker run` 声明启动方式时也能识别为本地包（§4 判定表未列，属扩展）；镜像引用必须是 `registry/namespace/name[:tag]` 形式，宿主路径一律拒绝。
11. **密钥传递**：容器凭据走 0600 临时 env-file 注入，不用 `-e KEY=VALUE`（避免留在宿主进程列表）。
12. **envJson 语义**：安装模板的 `envJson` 在自动安装时只登记 `{ requiredEnv: [...] }`，不写密钥值；值由用户在 Secret Vault 中维护。

### 使用示例

用户在聊天里发：

```
帮我把 https://github.com/modelcontextprotocol/servers/tree/main/src/github 装上
```

模型调用 `install_extension({ source: "..." })`，服务端返回：

```json
{
  "ok": true,
  "status": "needs_secret",
  "detected": { "kind": "mcp", "transport": "stdio" },
  "installed": { "installationId": 12, "connectionId": 34 },
  "requiredSecrets": [{ "name": "GITHUB_PERSONAL_ACCESS_TOKEN", "reason": "清单声明的环境变量" }],
  "nextSteps": ["在「凭据」里填入 GITHUB_PERSONAL_ACCESS_TOKEN 后刷新工具"]
}
```

模型据此告诉用户还缺什么；凭证填入后回到「工具」页刷新，即可在会话里调用。
