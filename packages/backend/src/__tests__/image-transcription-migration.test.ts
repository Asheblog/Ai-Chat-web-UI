import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const Database = require('better-sqlite3')
const migrationPath = join(__dirname, '../../prisma/migrations/20261113120000_remove_image_transcription/migration.sql')

const removedKeys = [
  'image_transcription_enabled',
  'image_transcription_connection_id',
  'image_transcription_model_id',
  'image_transcription_reasoning_enabled',
  'image_transcription_reasoning_effort',
]

// 近义键：LIKE 的 "_" 是单字符通配且不区分 ASCII 大小写，会把前三条一并吃掉。
const survivingKeys = [
  'IMAGE_TRANSCRIPTION_ENABLED',
  'image-transcription_enabled',
  'imageXtranscription_model_id',
  'image_foo',
  'image_transcription',
  'rag_relevance_threshold',
]

describe('remove image transcription migration', () => {
  it('drops image_descriptions_json, keeps history, and deletes only the five exact setting keys', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY,
          sessionId INTEGER REFERENCES chat_sessions(id),
          content TEXT,
          toolLogsJson TEXT,
          image_descriptions_json TEXT
        );
        CREATE TABLE message_attachments (
          id INTEGER PRIMARY KEY,
          messageId INTEGER REFERENCES messages(id),
          relativePath TEXT
        );
        CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO chat_sessions VALUES (1, 'history');
        INSERT INTO messages VALUES
          (11, 1, 'kept user turn', NULL, '[{"description":"图","modelRawId":"m"}]'),
          (12, 1, 'kept assistant turn', '[]', NULL);
        INSERT INTO message_attachments VALUES (21, 11, 'a.png'), (22, 12, 'b.png');
        INSERT INTO system_settings VALUES
          ('image_transcription_enabled', 'true'),
          ('image_transcription_connection_id', '3'),
          ('image_transcription_model_id', 'gpt-4o'),
          ('image_transcription_reasoning_enabled', 'true'),
          ('image_transcription_reasoning_effort', 'low'),
          ('IMAGE_TRANSCRIPTION_ENABLED', 'keep'),
          ('image-transcription_enabled', 'keep'),
          ('imageXtranscription_model_id', 'keep'),
          ('image_foo', 'keep'),
          ('image_transcription', 'keep'),
          ('rag_relevance_threshold', '0.5');
      `)
      db.exec(readFileSync(migrationPath, 'utf8'))

      expect(db.pragma('table_info(messages)').map((column: { name: string }) => column.name))
        .not.toContain('image_descriptions_json')

      expect(db.prepare('SELECT id, content FROM messages ORDER BY id').all())
        .toEqual([{ id: 11, content: 'kept user turn' }, { id: 12, content: 'kept assistant turn' }])
      expect(db.prepare('SELECT id, relativePath FROM message_attachments ORDER BY id').all())
        .toEqual([{ id: 21, relativePath: 'a.png' }, { id: 22, relativePath: 'b.png' }])
      expect(db.pragma('foreign_key_check')).toEqual([])

      const remainingKeys = db.prepare('SELECT key FROM system_settings ORDER BY key').all()
        .map((row: { key: string }) => row.key)
      for (const key of removedKeys) expect(remainingKeys).not.toContain(key)
      expect(remainingKeys).toEqual(expect.arrayContaining(survivingKeys))
      expect(remainingKeys).toEqual([...survivingKeys].sort())
    } finally {
      db.close()
    }
  })
})
