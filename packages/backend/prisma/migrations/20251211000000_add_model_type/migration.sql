-- 添加 modelType 字段到 model_catalog 表
-- 用于区分模型类型: 'chat' | 'embedding' | 'both'

-- 添加 modelType 列，默认值为 'chat' (保持向后兼容)
ALTER TABLE "model_catalog" ADD COLUMN "modelType" TEXT NOT NULL DEFAULT 'chat';

-- 基于现有模型ID自动识别并更新 embedding 类型的模型
-- 常见的 embedding 模型模式
UPDATE "model_catalog"
SET "modelType" = 'embedding'
WHERE
  LOWER("rawId") LIKE '%embedding%'
  OR LOWER("rawId") LIKE '%embed%'
  OR LOWER("rawId") LIKE '%ada-002%'
  OR LOWER("rawId") LIKE '%text-embedding%'
  OR LOWER("rawId") LIKE '%bge-%'
  OR LOWER("rawId") LIKE '%e5-%'
  OR LOWER("rawId") LIKE '%nomic-embed%'
  OR LOWER("rawId") LIKE '%mxbai-embed%'
  OR LOWER("rawId") LIKE '%snowflake-arctic-embed%'
  OR LOWER("rawId") LIKE '%all-minilm%';

-- 创建索引以优化按模型类型查询
CREATE INDEX "model_catalog_modelType_idx" ON "model_catalog"("modelType");
