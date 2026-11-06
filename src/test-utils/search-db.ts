/**
 * A real in-memory SQLite database for search tests: every migration
 * (including the chunks_fts keyword index), the SQL functions ctx registers,
 * and one project's chunks, inserted in order (rowids 1, 2, ...).
 */
import Database from 'better-sqlite3';

import { registerSqlFunctions } from '../database/connection.js';
import { MIGRATIONS } from '../database/migrate.js';

export interface SearchTestChunk {
  id: string;
  content: string;
  file_path: string;
  file_type: string | null;
  language: string | null;
  start_line: number | null;
  end_line: number | null;
  metadata: string | null;
  /** Stored as a Float32 blob (a Buffer is stored as is); a 1-float placeholder if absent */
  embedding?: number[] | Float32Array | Buffer;
}

export function createSearchTestDb(chunks: SearchTestChunk[], projectId = 'test-project'): Database.Database {
  const db = new Database(':memory:');
  registerSqlFunctions(db);
  for (const migration of MIGRATIONS) db.exec(migration.sql);

  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(projectId, projectId, `/${projectId}`);
  const insert = db.prepare(
    `INSERT INTO chunks (id, project_id, content, embedding, file_path, file_type, language, start_line, end_line, metadata)
     VALUES (@id, @projectId, @content, @embedding, @file_path, @file_type, @language, @start_line, @end_line, @metadata)`
  );
  for (const chunk of chunks) {
    const { embedding } = chunk;
    const vector = Buffer.isBuffer(embedding)
      ? embedding
      : Buffer.from(new Float32Array(embedding ?? [0]).buffer);
    insert.run({ ...chunk, projectId, embedding: vector });
  }
  return db;
}
