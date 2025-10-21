#!/usr/bin/env tsx
/**
 * 数据库初始化脚本
 * 用于初始化数据库结构和默认数据
 */
declare function initDatabase(): Promise<void>;
export { initDatabase };
