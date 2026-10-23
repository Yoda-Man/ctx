/**
 * Database Module
 *
 * SQLite storage for projects and document chunks.
 *
 * @example
 * ```ts
 * import { getDatabase, runMigrations, type Project } from './database/index.js';
 *
 * // Run migrations on startup
 * runMigrations();
 *
 * // Use high-level operations
 * const db = getDatabase();
 * const projects = db.getAllProjects();
 * ```
 */

// Connection management (low-level)
export { getDb, closeDb, getDbPath, getCtxDir } from './connection.js';

// Migration utilities
export {
  runMigrations,
  hasPendingMigrations,
  getAppliedMigrations,
  // State tracking (Ticket #52)
  
  
  
  // Result type (Ticket #52)
  
} from './migrate.js';

// Schema types
export type {
  Project,
  ProjectInput,
  Chunk,
  ChunkInput,
  FileHash,
  FileHashInput,
} from './schema.js';

// Utility functions
export { generateId, embeddingToBlob, blobToEmbedding } from './schema.js';

// Validation schemas and utilities (Ticket #51)
export {
  // Full row schemas
  
  
  
  // Partial schemas for store loading
  
  
  // Types
  
  
  
  
  
  // Error class
  
  // Validation functions
  
  
  
} from './validation.js';

// High-level database operations
export {
  getDatabase,
  resetDatabase,
  
  
  
  
} from './operations.js';
