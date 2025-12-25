/**
 * 文档章节迁移脚本
 * 为现有文档生成目录索引
 *
 * 使用方法：
 * pnpm --filter backend tsx scripts/migrate-document-sections.ts
 *
 * 可选参数：
 * --dry-run    只分析不写入
 * --doc-id=N   只处理指定文档
 * --kb-id=N    只处理指定知识库的文档
 */

/// <reference types="node" />

import { PrismaClient } from '@prisma/client'
import { PDFStructureExtractor } from '../src/modules/document/structure'
import type { ChunkWithMetadata } from '../src/modules/document/structure/types'

const prisma = new PrismaClient()

interface MigrationOptions {
  dryRun: boolean
  documentId?: number
  knowledgeBaseId?: number
}

function parseArgs(): MigrationOptions {
  const args: string[] = process.argv.slice(2)
  return {
    dryRun: args.includes('--dry-run'),
    documentId: args.find((a: string) => a.startsWith('--doc-id='))
      ? parseInt(args.find((a: string) => a.startsWith('--doc-id='))!.split('=')[1])
      : undefined,
    knowledgeBaseId: args.find((a: string) => a.startsWith('--kb-id='))
      ? parseInt(args.find((a: string) => a.startsWith('--kb-id='))!.split('=')[1])
      : undefined,
  }
}

async function getDocumentsToProcess(options: MigrationOptions): Promise<number[]> {
  if (options.documentId) {
    return [options.documentId]
  }
  
  if (options.knowledgeBaseId) {
    const kbDocs = await prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId: options.knowledgeBaseId },
      select: { documentId: true },
    })
    return kbDocs.map(d => d.documentId)
  }
  
  // 获取所有 ready 状态的文档
  const docs = await prisma.document.findMany({
    where: { status: 'ready' },
    select: { id: true },
  })
  return docs.map(d => d.id)
}

async function processDocument(
  documentId: number,
  extractor: PDFStructureExtractor,
  options: MigrationOptions
): Promise<{ success: boolean; sectionsFound: number; error?: string }> {
  try {
    // 获取文档信息
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
        },
      },
    })
    
    if (!document) {
      return { success: false, sectionsFound: 0, error: '文档不存在' }
    }
    
    if (document.chunks.length === 0) {
      return { success: false, sectionsFound: 0, error: '文档没有 chunks' }
    }
    
    // 转换 chunks 格式
    const chunks: ChunkWithMetadata[] = document.chunks.map((chunk: any) => {
      let meta: any = {}
      try {
        meta = typeof chunk.metadata === 'string' 
          ? JSON.parse(chunk.metadata) 
          : (chunk.metadata || {})
      } catch {
        meta = {}
      }
      
      return {
        chunkIndex: chunk.chunkIndex,
        content: chunk.content || '',
        pageNumber: meta.pageNumber,
        metadata: meta,
      }
    })
    
    // 提取章节结构（没有 PDF 书签，使用启发式检测）
    const result = extractor.extract(documentId, null, chunks)
    
    if (options.dryRun) {
      console.log(`  [DRY RUN] 发现 ${result.sections.length} 个章节`)
      if (result.sections.length > 0) {
        console.log(`  前3个章节:`)
        result.sections.slice(0, 3).forEach(s => {
          console.log(`    ${s.path} ${s.title} (level ${s.level}, page ${s.startPage || '?'})`)
        })
      }
      return { success: true, sectionsFound: result.sections.length }
    }
    
    // 删除现有章节
    await (prisma as any).documentSection.deleteMany({
      where: { documentId },
    })
    
    if (result.sections.length === 0) {
      return { success: true, sectionsFound: 0 }
    }
    
    // 按层级和路径排序，确保父节点先创建
    const sortedSections = [...result.sections].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      return a.path.localeCompare(b.path)
    })
    
    // 路径到 ID 的映射
    const pathToId = new Map<string, number>()
    
    // 逐个创建章节
    for (const section of sortedSections) {
      // 查找父节点 ID
      let parentId: number | null = null
      if (section.level > 1) {
        const parentPath = section.path.split('.').slice(0, -1).join('.')
        parentId = pathToId.get(parentPath) ?? null
      }
      
      const created = await (prisma as any).documentSection.create({
        data: {
          documentId: section.documentId,
          parentId,
          level: section.level,
          title: section.title,
          path: section.path,
          startPage: section.startPage,
          endPage: section.endPage,
          startChunk: section.startChunk,
          endChunk: section.endChunk,
          detectionMethod: section.detectionMethod,
          confidence: section.confidence,
          metadata: JSON.stringify(section.metadata || {}),
        },
      })
      
      pathToId.set(section.path, created.id)
    }
    
    // 更新 chunks 的 sectionId
    for (const section of sortedSections) {
      const sectionId = pathToId.get(section.path)
      if (!sectionId) continue
      
      const startChunk = section.startChunk ?? 0
      const endChunk = section.endChunk ?? startChunk
      
      await prisma.documentChunk.updateMany({
        where: {
          documentId,
          chunkIndex: {
            gte: startChunk,
            lte: endChunk,
          },
        },
        data: {
          sectionId,
        } as any,
      })
    }
    
    return { success: true, sectionsFound: result.sections.length }
  } catch (error) {
    return {
      success: false,
      sectionsFound: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  console.log('=== 文档章节迁移脚本 ===\n')
  
  const options = parseArgs()
  console.log('选项:', options)
  console.log('')
  
  const extractor = new PDFStructureExtractor()
  
  // 获取要处理的文档
  const documentIds = await getDocumentsToProcess(options)
  console.log(`找到 ${documentIds.length} 个文档需要处理\n`)
  
  if (documentIds.length === 0) {
    console.log('没有需要处理的文档')
    return
  }
  
  // 统计
  let processed = 0
  let succeeded = 0
  let totalSections = 0
  const errors: Array<{ docId: number; error: string }> = []
  
  // 逐个处理
  for (const docId of documentIds) {
    processed++
    process.stdout.write(`[${processed}/${documentIds.length}] 处理文档 ${docId}...`)
    
    const result = await processDocument(docId, extractor, options)
    
    if (result.success) {
      succeeded++
      totalSections += result.sectionsFound
      console.log(` ✓ (${result.sectionsFound} 章节)`)
    } else {
      console.log(` ✗ ${result.error}`)
      errors.push({ docId, error: result.error || '未知错误' })
    }
  }
  
  // 汇总
  console.log('\n=== 迁移完成 ===')
  console.log(`处理: ${processed} 个文档`)
  console.log(`成功: ${succeeded} 个文档`)
  console.log(`失败: ${errors.length} 个文档`)
  console.log(`章节: ${totalSections} 个`)
  
  if (errors.length > 0) {
    console.log('\n失败列表:')
    errors.forEach(e => console.log(`  文档 ${e.docId}: ${e.error}`))
  }
  
  if (options.dryRun) {
    console.log('\n[DRY RUN] 以上为预览，未实际写入数据库')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())