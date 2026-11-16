# Issue tracker: GitHub

本仓库的 issue、规格和任务记录在 [Asheblog/Ai-Chat-web-UI 的 GitHub Issues](https://github.com/Asheblog/Ai-Chat-web-UI/issues)。后端为 GitHub。

## 常用操作

在本仓库目录使用 `gh` CLI；从 `git remote -v` 推断仓库，显式指定时使用 `--repo Asheblog/Ai-Chat-web-UI`。

- 创建：`gh issue create --title "..." --body-file <path>`。多行正文先写入 UTF-8 文件，再用 `--body-file` 传入。
- 读取：`gh issue view <number> --comments`；需要结构化字段时加 `--json number,title,body,labels,assignees,comments,state`。
- 列表：`gh issue list --state open --json number,title,body,labels,assignees`；按需使用 `--label` 和 `--state`。
- 评论：`gh issue comment <number> --body-file <path>`。
- 添加或移除标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- 指派：`gh issue edit <number> --add-assignee @me`。
- 关闭：`gh issue close <number> --comment "..."`。

DSH 会话提供 `deck_*` 工具时，先用 `deck_context` 确认当前 workspace 与 backend，再按工具契约读写 issue 和关系；GitHub 仍是记录的落点。

## Pull requests as a triage surface

**PRs as a request surface: no.**

如维护者以后启用该入口，将本标记改为 `yes`；`/triage` 会读取它。启用后按 `gh pr view`、`gh pr list`、`gh pr comment`、`gh pr edit` 和 `gh pr close` 操作外部 PR。GitHub 的 issue 与 PR 共用编号空间，读取编号时确认对象类型。

## 技能指令的落点

- “publish to the issue tracker”：创建 GitHub issue。
- “fetch the relevant ticket”：读取对应 issue 的正文、标签、指派和评论。
- triage 五角色词汇见 [triage-labels.md](triage-labels.md)，标签的使用时机由调用的技能决定。

## Wayfinding operations

- **Map**：单张 issue，标签为 `wayfinder:map`，正文承载 Notes / Decisions so far / Fog。
- **Child ticket**：以 GitHub sub-issue 关联到 map，按类型使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`；认领后指派给负责开发者。若仓库未提供 sub-issues，在 map 的任务列表中列出子票，并在子票顶部写 `Part of #<map>`。
- **Blocking**：使用 GitHub 原生 issue dependencies。以 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 取得阻塞者的数字数据库 ID，再调用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`。开放阻塞数量由 `issue_dependencies_summary.blocked_by` 表达；若仓库未提供 dependencies，在子票顶部写 `Blocked by: #<n>, #<n>`，全部阻塞票关闭后才可接。
- **Frontier**：按 map 顺序，从开放子票中挑选全部阻塞已关闭且尚未指派的第一张。
- **Claim**：开始处理时指派给当前开发者，作为该会话对票的首次写入。
- **Resolve**：记录答案并关闭子票，再把结论摘要和链接追加到 map 的 Decisions so far。
