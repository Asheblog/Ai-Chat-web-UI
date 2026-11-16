# Domain Docs

本仓库采用 **single-context**：整个仓库共用根目录的 `GLOSSARY.md`，架构决定记录在根目录的 `docs/adr/`。

## 探索前读取

- 根目录的 [GLOSSARY.md](../../GLOSSARY.md)：全仓共享的领域词汇和业务规则，包括各 package 涉及的概念。
- [docs/adr/](../adr/)：读取与本次工作相关的架构决定。

文件尚未存在时直接继续；在第一次真正确定词条或决定时，由 `/domain-modeling`（也可通过 `/grill-with-docs`、`/improve-codebase-architecture` 进入）按需创建对应文档。

## 文档布局

```text
/
├── GLOSSARY.md
├── docs/
│   ├── agents/domain.md
│   └── adr/
└── packages/
```

各子项目共用根词表；本次初始化沿用已有词条，不创建 `GLOSSARY-MAP.md` 或各子项目的 `GLOSSARY.md`。

## 使用词表中的语言

在 issue 标题、实现方案、假设、测试名和代码中命名领域概念时，使用 `GLOSSARY.md` 定义的术语。需要的概念尚未收录时，先检查是否误用了项目外的说法；确有缺口时，交给 `/domain-modeling` 随实际工作补充。

## 显式处理 ADR 冲突

方案与已有 ADR 冲突时，指出 ADR 编号、冲突内容和重新讨论的理由，再记录采纳的决定。
