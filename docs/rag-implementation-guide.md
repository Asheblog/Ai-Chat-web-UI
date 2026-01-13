# 文档解析 (RAG) 功能实施完成报告

## 实施概要

已完成 AIChat 项目的文档解析 (RAG) 功能核心实现，包括后端服务、API、数据库模型和前端组件。

## 已完成的工作

### Phase 1: 核心基础设施

1. **Prisma Schema 更新**
   - 新增模型: `Document`, `DocumentChunk`, `SessionDocument`
   - 文件: `packages/backend/prisma/schema.prisma`

2. **数据库迁移 SQL**
   - 迁移文件: `packages/backend/prisma/migrations/20251211090000_add_document_rag_models/migration.sql`

3. **向量数据库客户端**
   - 基于 SQLite 的轻量级向量存储实现
   - 文件: `packages/backend/src/modules/document/vector/`

4. **文档加载器**
   - 支持: PDF, DOCX, CSV, TXT, Markdown
   - 文件: `packages/backend/src/modules/document/loaders/`

5. **文本分块服务**
   - RecursiveCharacterTextSplitter 实现
   - 文件: `packages/backend/src/services/document/chunking-service.ts`

### Phase 2: 服务层

6. **EmbeddingService**
   - 双引擎支持: OpenAI + Ollama
   - 文件: `packages/backend/src/services/document/embedding-service.ts`

7. **DocumentService**
   - 文档上传、解析、处理完整流程
   - 文件: `packages/backend/src/services/document/document-service.ts`

7.1. **Document Worker (新增)**
   - 独立后台任务进程，消费 `document_processing_jobs` 队列
   - 解决大文档解析阻塞 API/导致前端卡圈圈问题
   - 文件: `packages/backend/src/workers/document-worker.ts`

8. **RAGService**
   - 向量检索 + 上下文构建
   - 文件: `packages/backend/src/services/document/rag-service.ts`

### Phase 3: API 和聊天集成

9. **文档 API 路由**
   - 端点: `/api/documents/*`
   - 文件: `packages/backend/src/api/documents.ts`

10. **RAG Context Builder**
    - SSE 事件类型定义
    - 文件: `packages/backend/src/modules/chat/rag-context-builder.ts`

11. **服务工厂**
    - 统一初始化入口
    - 文件: `packages/backend/src/services/document-services-factory.ts`

### Phase 3.5: 工具接口升级（破坏性，无迁移、直接替换）

- **会话文档工具**: `document_list`, `document_search`, `document_get_content`, `document_get_toc`, `document_get_section`
- **知识库工具**: `kb_list`, `kb_get_documents`, `kb_search`, `kb_get_document_content`, `kb_get_toc`, `kb_get_section`
- **已移除旧工具**: `document_get_outline`, `document_get_page`, `document_get_page_range`, `kb_search_v2`
- **迁移策略**: 无迁移、直接替换（工具调用按新接口执行）

### Phase 4: 前端

12. **文档上传 Hook**
    - 文件: `packages/frontend/src/features/chat/composer/use-document-attachments.ts`

13. **文档附件组件**
    - 文件: `packages/frontend/src/features/chat/composer/document-attachment.tsx`

14. **RAG 分析面板**
    - 类似推理链的折叠面板
    - 文件: `packages/frontend/src/components/message-bubble/rag-analysis-section.tsx`

### Phase 5: 清理机制

15. **清理调度器**
    - 时间过期 + 孤立文档 + 存储超限清理
    - 文件: `packages/backend/src/services/cleanup/cleanup-scheduler.ts`

## 安装步骤

### 1. 安装新依赖

```bash
cd packages/backend
pnpm add better-sqlite3 mammoth papaparse pdf-parse uuid
pnpm add -D @types/better-sqlite3 @types/papaparse @types/pdf-parse @types/uuid
```

### 2. 运行数据库迁移

```bash
# 开发环境
npx prisma migrate dev

# 生产环境
npx prisma migrate deploy
```

或者直接执行 SQL（包含新文档分页字段迁移）:
```bash
sqlite3 prisma/data/app.db < prisma/migrations/20251211090000_add_document_rag_models/migration.sql
sqlite3 prisma/data/app.db < prisma/migrations/20260202090000_add_document_chunk_page_fields/migration.sql
```

### 3. 配置环境变量

```env
# Embedding 配置 (二选一)

# OpenAI 方式
RAG_EMBEDDING_ENGINE=openai
OPENAI_API_KEY=your-api-key
OPENAI_API_URL=https://api.openai.com/v1

# Ollama 方式
RAG_EMBEDDING_ENGINE=ollama
OLLAMA_API_URL=http://localhost:11434
RAG_EMBEDDING_MODEL=nomic-embed-text
```

### 4. 注册 API 路由

在 `packages/backend/src/index.ts` 中添加:

```typescript
import { createDocumentsApi } from './api/documents'
import { initDocumentServices } from './services/document-services-factory'

// 初始化文档服务
const documentServices = initDocumentServices(appContext.prisma, {
  embedding: {
    engine: process.env.RAG_EMBEDDING_ENGINE as 'openai' | 'ollama' || 'openai',
    model: process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
    apiUrl: process.env.OPENAI_API_URL,
  },
})

// 启动清理调度器
documentServices.cleanupScheduler.start()

// 注册路由
app.route('/api/documents', createDocumentsApi({
  documentService: documentServices.documentService,
  ragService: documentServices.ragService,
}))
```

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/documents/supported-types` | 获取支持的文件类型 |
| POST | `/api/documents/upload` | 上传文档 |
| GET | `/api/documents` | 获取文档列表 |
| GET | `/api/documents/:id` | 获取文档详情 |
| DELETE | `/api/documents/:id` | 删除文档 |
| POST | `/api/documents/:id/attach` | 附加到会话 |
| DELETE | `/api/documents/:id/detach/:sessionId` | 从会话移除 |
| GET | `/api/documents/session/:sessionId` | 获取会话文档 |
| POST | `/api/documents/search` | RAG 搜索 |

## 后续集成工作

1. **聊天流集成**: 在 `stream.ts` 中调用 `RAGContextBuilder` 进行文档检索
2. **前端集成**: 在聊天组件中使用 `useDocumentAttachments` hook
3. **UI 集成**: 在消息渲染中使用 `RAGAnalysisSection` 组件

## 文件结构

```
packages/backend/src/
├── api/
│   └── documents.ts                    # 文档 API 路由
├── modules/document/
│   ├── loaders/                        # 文档加载器
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── text-loader.ts
│   │   ├── pdf-loader.ts
│   │   ├── docx-loader.ts
│   │   └── csv-loader.ts
│   └── vector/                         # 向量数据库
│       ├── index.ts
│       ├── types.ts
│       └── sqlite-vector-client.ts
├── services/
│   ├── document/                       # 文档服务
│   │   ├── index.ts
│   │   ├── chunking-service.ts
│   │   ├── embedding-service.ts
│   │   ├── document-service.ts
│   │   └── rag-service.ts
│   ├── cleanup/                        # 清理服务
│   │   ├── index.ts
│   │   └── cleanup-scheduler.ts
│   └── document-services-factory.ts    # 服务工厂

packages/frontend/src/
├── features/chat/composer/
│   ├── use-document-attachments.ts     # 文档上传 Hook
│   └── document-attachment.tsx         # 文档附件组件
└── components/message-bubble/
    └── rag-analysis-section.tsx        # RAG 分析面板
```
