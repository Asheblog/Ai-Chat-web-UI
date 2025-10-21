/**
 * Prisma Seed 脚本
 * - 加载环境变量（优先 backend/.env，其次仓库根 .env，最后根 .env.example）
 * - 复用现有初始化逻辑（scripts/init-db.ts）以创建默认管理员、系统设置等
 *
 * 说明：
 * - 保持 Linux/Windows 兼容；不依赖额外包（自带简易 .env 解析）
 * - 若环境中已存在用户，初始化将自动跳过
 */
/* UTF-8, no BOM */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../scripts/init-db';
function loadEnvFile(file) {
    try {
        if (!fs.existsSync(file))
            return false;
        const raw = fs.readFileSync(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            if (!line || /^\s*#/.test(line))
                continue;
            const idx = line.indexOf('=');
            if (idx <= 0)
                continue;
            const key = line.slice(0, idx).trim();
            let val = line.slice(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!(key in process.env)) {
                process.env[key] = val;
            }
        }
        return true;
    }
    catch (_) {
        return false;
    }
}
function loadEnvCascade() {
    // 当前文件位于 packages/backend/prisma
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const backendDir = path.resolve(__dirname, '..');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    // 候选顺序：backend/.env -> 根 .env -> 根 .env.example
    const candidates = [
        path.join(backendDir, '.env'),
        path.join(repoRoot, '.env'),
        path.join(repoRoot, '.env.example'),
    ];
    let loaded = false;
    for (const p of candidates) {
        loaded = loadEnvFile(p) || loaded;
    }
    if (!loaded) {
        // 不强求，Prisma CLI 也会按其规则加载 .env；此处只是增强
        console.warn('[seed] 未从文件加载环境变量，将使用进程环境变量');
    }
}
async function main() {
    // 加载环境
    loadEnvCascade();
    // 标准初始化
    await initDatabase();
}
main().catch((err) => {
    console.error('[seed] 失败：', err?.message || String(err));
    process.exit(1);
});
