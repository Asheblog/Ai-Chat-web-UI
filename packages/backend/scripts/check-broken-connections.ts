#!/usr/bin/env tsx

/**
 * 诊断脚本：检查 bearer 连接缺少 secretVaultId 的情况。
 *
 * 迁移 20260612150000 新增 secret_vault_id 列但无法自动将旧 connections.apiKey
 * 加密搬入 secret_vault（SQLite 无法执行 Node AES 加密），因此旧连接可能出现
 * bearer + secretVaultId IS NULL。
 *
 * 此脚本列出此类连接并给出修复指引。
 *
 * 可重复执行，安全无副作用。不会输出任何密钥原文。
 *
 * 使用: npx tsx scripts/check-broken-connections.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface BrokenConnection {
  id: bigint
  provider: string
  apiKeyLabel: string | null
  enable: boolean
  createdAt: Date
  updatedAt: Date
}

async function main(): Promise<void> {
  console.log('=== 诊断：Bearer 连接缺少 secretVaultId ===\n')

  const totalConnections = await prisma.connection.count()
  console.log(`连接总数: ${totalConnections}\n`)

  const broken: BrokenConnection[] = await prisma.$queryRaw`
    SELECT id, provider, "apiKeyLabel", enable, "createdAt", "updatedAt"
    FROM connections
    WHERE "authType" = 'bearer' AND secret_vault_id IS NULL
    ORDER BY id ASC
  `

  if (broken.length === 0) {
    console.log('✓ 所有 bearer 连接均有有效的 secretVaultId，无需处理。')
    return
  }

  console.log(`⚠ 发现 ${broken.length} 个 bearer 连接缺少 secretVaultId：\n`)

  for (const conn of broken) {
    console.log(`  [#${conn.id}] ${conn.provider}`)
    console.log(`        标签: ${conn.apiKeyLabel ?? '(无标签)'}`)
    console.log(`        启用: ${conn.enable}`)
    console.log(`        创建于: ${conn.createdAt.toISOString()}`)
    console.log(`        更新于: ${conn.updatedAt.toISOString()}`)
    console.log()
  }

  console.log('=== 修复指引 ===')
  console.log()
  console.log('这些连接缺少加密存储的 API Key，原因：')
  console.log('  迁移 20260612150000 新增 secret_vault_id 列时，')
  console.log('  因 SQLite 无法在 SQL 中执行 Node AES 加密，')
  console.log('  旧 connections.apiKey 无法自动搬入 secret_vault 表。')
  console.log()
  console.log('修复方法：')
  console.log('  选项 A：在管理后台重新为该连接保存 API Key。')
  console.log('        保存操作会自动创建 Secret Vault 条目并写入 secret_vault_id。')
  console.log()
  console.log('  选项 B：运行以下 SQL（前提是您有迁移前的数据库备份，')
  console.log('        并能在应用层自行加密后插入 secret_vault 表）：')
  console.log('    -- 此操作需要您在应用层用 SECRET_VAULT_MASTER_KEY 加密 API Key，')
  console.log('    -- 然后 INSERT INTO secret_vault (...) VALUES (...)，')
  console.log('    -- 最后 UPDATE connections SET secret_vault_id = ? WHERE id = ?')
  console.log()
  console.log('  选项 C：联系管理员在迁移前备份中找回旧 apiKey，')
  console.log('        在管理后台重新录入。')
  console.log()
  console.log('⚠ 重要：此脚本仅用于诊断，不会修改任何数据。')
  console.log('  旧 apiKey 列已在迁移 20260612160000 中被丢弃，无法从当前数据库恢复。')
}

main()
  .catch((error) => {
    console.error('诊断失败:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
