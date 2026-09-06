import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const Database = require('better-sqlite3')
const migrationPath = join(__dirname, '../../prisma/migrations/20260906000000_retire_azure_ollama/migration.sql')

describe('retired provider migration', () => {
  it('disables retired connections while preserving historical relations and credentials', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE connection_groups (id INTEGER PRIMARY KEY, provider TEXT, enable BOOLEAN, azureApiVersion TEXT);
        CREATE TABLE connections (id INTEGER PRIMARY KEY, connection_group_id INTEGER REFERENCES connection_groups(id), secret_vault_id INTEGER);
        CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, connectionId INTEGER REFERENCES connection_groups(id), title TEXT, ollamaThink BOOLEAN);
        CREATE TABLE messages (id INTEGER PRIMARY KEY, sessionId INTEGER REFERENCES chat_sessions(id), content TEXT);
        CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO connection_groups VALUES (1, 'azure_openai', 1, 'old'), (2, 'ollama', 1, NULL), (3, 'openai', 1, NULL);
        INSERT INTO connections VALUES (11, 1, 101), (12, 2, 102), (13, 3, 103);
        INSERT INTO chat_sessions VALUES (21, 1, 'history', 1), (22, 2, 'local history', 0);
        INSERT INTO messages VALUES (31, 21, 'preserved'), (32, 22, 'also preserved');
        INSERT INTO system_settings VALUES ('ollama_think', 'true'), ('image_transcription_ollama_think', 'true'), ('reasoning_enabled', 'true');
      `)
      if (existsSync(migrationPath)) db.exec(readFileSync(migrationPath, 'utf8'))
      expect(db.prepare('SELECT id, enable FROM connection_groups ORDER BY id').all())
        .toEqual([{ id: 1, enable: 0 }, { id: 2, enable: 0 }, { id: 3, enable: 1 }])
      expect(db.prepare('SELECT * FROM messages ORDER BY id').all()).toHaveLength(2)
      expect(db.prepare('SELECT connectionId FROM chat_sessions ORDER BY id').all())
        .toEqual([{ connectionId: 1 }, { connectionId: 2 }])
      expect(db.prepare('SELECT secret_vault_id FROM connections ORDER BY id').all())
        .toEqual([{ secret_vault_id: 101 }, { secret_vault_id: 102 }, { secret_vault_id: 103 }])
      expect(db.prepare('SELECT * FROM system_settings').all())
        .toEqual([{ key: 'reasoning_enabled', value: 'true' }])
      expect(db.pragma('table_info(connection_groups)').map((column: { name: string }) => column.name))
        .not.toContain('azureApiVersion')
      expect(db.pragma('table_info(chat_sessions)').map((column: { name: string }) => column.name))
        .not.toContain('ollamaThink')
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      db.close()
    }
  })
})
