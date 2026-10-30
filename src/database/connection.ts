/**
 * Database Connection Module
 *
 * Provides a singleton SQLite connection using better-sqlite3.
 * The database is stored at ~/.ctx/context.db
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { CTX_DIR, DB_PATH, getCtxDir, getDbPath } from '../config/paths.js';

// Module-level singleton instance
let db: Database.Database | null = null;

/**
 * Get the singleton database instance.
 *
 * Creates the database and ~/.ctx directory on first call.
 * Subsequent calls return the same instance.
 *
 * @example
 * ```ts
 * const db = getDb();
 * const projects = db.prepare('SELECT * FROM projects').all();
 * ```
 */
export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure ~/.ctx directory exists
  if (!existsSync(CTX_DIR)) {
    mkdirSync(CTX_DIR, { recursive: true });
  }

  // Create connection with optimal settings
  db = new Database(DB_PATH);

  // Enable foreign keys (OFF by default in SQLite!)
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Register cleanup on process exit
  process.on('exit', () => closeDb());
  process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
  });

  return db;
}

/**
 * Close the database connection.
 *
 * Call this when shutting down the application.
 * Safe to call multiple times or when no connection exists.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Re-export path functions from centralized paths module
export { getCtxDir, getDbPath };

/**
 * Size of the database on disk, in bytes: the file plus its write-ahead log.
 * In WAL mode new rows land in the log until a checkpoint, so the file alone
 * reported "+0 B" after indexing.
 */
export function getDbFileSize(): number {
  const dbPath = getDbPath();
  return [dbPath, `${dbPath}-wal`].reduce((total, path) => total + (existsSync(path) ? statSync(path).size : 0), 0);
}
