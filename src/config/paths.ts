/**
 * Centralized Path Definitions
 *
 * Single source of truth for all ctx directory paths.
 * All modules should import from here instead of computing paths locally.
 *
 * Directory structure:
 * ~/.ctx/
 * ├── context.db      (SQLite database)
 * ├── config.toml     (User configuration)
 * └── models/         (Downloaded embedding and reranker models)
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

// Core path constants - the single source of truth
export const CTX_DIR = join(homedir(), '.ctx');

/**
 * Downloaded embedding and reranker models. Kept here, beside the index,
 * rather than in transformers.js's default (inside its own package folder),
 * where every reinstall or Node version change threw away a ~600 MB download.
 */
export const MODELS_DIR = join(CTX_DIR, 'models');
export const DB_PATH = join(CTX_DIR, 'context.db');
const CONFIG_PATH = join(CTX_DIR, 'config.toml');

/**
 * Get the ctx directory path (~/.ctx)
 * @returns Absolute path to the ctx directory
 */
export function getCtxDir(): string {
  return CTX_DIR;
}

/**
 * Get the database file path (~/.ctx/context.db)
 * @returns Absolute path to the SQLite database
 */
export function getDbPath(): string {
  return DB_PATH;
}

/**
 * Get the config file path (~/.ctx/config.toml)
 * @returns Absolute path to the TOML config file
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}
