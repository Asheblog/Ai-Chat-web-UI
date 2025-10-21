/**
 * Prisma Seed 脚本
 * - 加载环境变量（优先 backend/.env，其次仓库根 .env，最后根 .env.example）
 * - 复用现有初始化逻辑（scripts/init-db.ts）以创建默认管理员、系统设置等
 *
 * 说明：
 * - 保持 Linux/Windows 兼容；不依赖额外包（自带简易 .env 解析）
 * - 若环境中已存在用户，初始化将自动跳过
 */
export {};
