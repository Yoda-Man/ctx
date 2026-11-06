/**
 * BM25 Store Manager
 *
 * Keyword (BM25) search over a project's chunks, answered by SQLite's FTS5
 * index (chunks_fts, migration 008). Before, every process loaded all of a
 * project's chunks and built a BM25 index in memory on its first search:
 * 12 s and about 2.7 GB for 200,000 chunks. FTS5 keeps the index on disk,
 * so a search starts at once and holds no copy of the chunks.
 *
 * Scoring is FTS5's bm25() with k1 = 1.2 and b = 0.75, the values ctx used.
 * One difference: FTS5 counts term rarity (IDF) over every indexed chunk,
 * not one project's. Tokens come from ctx's own tokenizer (camelCase split),
 * applied at index time by ctx_tokens() and here to the query.
 */

import type Database from 'better-sqlite3';

import { defaultTokenizer } from '../sdk/rag/retrieval/bm25.js';
import { RetrieverError } from '../sdk/rag/retrieval/errors.js';
import type { RetrievalOptions, RetrievalResult } from '../sdk/rag/index.js';
import { getDb } from '../database/connection.js';
import { ChunkLoadNoEmbeddingSchema, validateRows } from '../database/validation.js';
import { safeJsonParse, type Logger, consoleLogger } from '../utils/index.js';

/**
 * Options for a project's keyword retriever.
 */
export interface BM25StoreOptions {
  /** Project ID to scope the search */
  projectId: string;
}

/** Chunk metadata columns that a search filter can match. */
const FILTER_COLUMNS: Record<string, string> = { fileType: 'file_type', language: 'language' };

/**
 * Keyword retriever for one project, backed by chunks_fts.
 */
export class FtsRetriever {
  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
    private readonly logger: Logger = consoleLogger
  ) {}

  /** Number of chunks in the project. */
  get documentCount(): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE project_id = ?').get(this.projectId) as {
        count: number;
      }
    ).count;
  }

  /**
   * Chunks matching any query token, best BM25 score first, scaled so the
   * best is 1. `filter` matches fileType and language before the topK cut.
   */
  retrieve = async (query: string, options: RetrievalOptions = {}): Promise<RetrievalResult[]> => {
    if (!query.trim()) throw RetrieverError.invalidQuery('FtsRetriever', 'Query cannot be empty');
    const tokens = [...new Set(defaultTokenizer(query))];
    if (tokens.length === 0) return [];

    // Tokens are letters and digits only, so quoting each is a safe phrase
    const match = tokens.map((t) => `"${t}"`).join(' OR ');
    const params: unknown[] = [match, this.projectId];
    let where = '';
    for (const [key, value] of Object.entries(options.filter ?? {})) {
      const column = FILTER_COLUMNS[key];
      if (!column) throw new Error(`Keyword search cannot filter on "${key}"`);
      where += ` AND c.${column} = ?`;
      params.push(value);
    }
    params.push(options.topK ?? 10);

    // bm25() is lower for a better match; negate it so higher is better
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.file_path, c.file_type, c.language, c.start_line, c.end_line, c.metadata,
                -bm25(chunks_fts) AS score
         FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.project_id = ?${where}
         ORDER BY score DESC
         LIMIT ?`
      )
      .all(...params) as Array<{ score: number }>;

    const chunks = validateRows(ChunkLoadNoEmbeddingSchema, rows, `chunks_fts project_id=${this.projectId}`);
    const best = rows[0]?.score && rows[0].score > 0 ? rows[0].score : 1;
    const minScore = options.minScore ?? 0;

    return chunks
      .map((row, i) => ({
        id: row.id,
        score: rows[i]!.score / best,
        chunk: {
          id: row.id,
          content: row.content,
          metadata: {
            projectId: this.projectId,
            filePath: row.file_path,
            fileType: row.file_type,
            language: row.language,
            startLine: row.start_line,
            endLine: row.end_line,
            ...safeJsonParse(row.metadata, {}, (err) => {
              this.logger.warn(`[BM25Store] Skipping corrupted metadata for chunk ${row.id}: ${err.message}`);
            }),
          },
        },
      }))
      .filter((result) => result.score > minScore);
  };
}

/**
 * Hands out a keyword retriever per project. There is nothing to build:
 * the index lives in SQLite and is kept current by triggers on chunks.
 */
export class BM25StoreManager {
  private retrievers = new Map<string, FtsRetriever>();

  /**
   * Get the keyword retriever for a project. Async and with an unused
   * progress callback to keep the interface of the in-memory index it replaced.
   */
  async getRetriever(
    options: BM25StoreOptions,
    _onProgress?: unknown,
    logger: Logger = consoleLogger
  ): Promise<FtsRetriever> {
    const { projectId } = options;
    let retriever = this.retrievers.get(projectId);
    if (!retriever) {
      retriever = new FtsRetriever(getDb(), projectId, logger);
      this.retrievers.set(projectId, retriever);
    }
    return retriever;
  }

  /** Check if a retriever is cached for a project. */
  hasRetriever(projectId: string): boolean {
    return this.retrievers.has(projectId);
  }

  /** Forget a project's retriever (after re-indexing or removal). */
  invalidate(projectId: string): void {
    this.retrievers.delete(projectId);
  }

  /** Forget all retrievers. */
  clearAll(): void {
    this.retrievers.clear();
  }

  /** Number of cached retrievers. */
  get cacheSize(): number {
    return this.retrievers.size;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let managerInstance: BM25StoreManager | null = null;

/**
 * Get the singleton BM25StoreManager instance.
 */
export function getBM25StoreManager(): BM25StoreManager {
  if (!managerInstance) {
    managerInstance = new BM25StoreManager();
  }
  return managerInstance;
}

/**
 * Reset the singleton instance.
 */
export function resetBM25StoreManager(): void {
  if (managerInstance) {
    managerInstance.clearAll();
    managerInstance = null;
  }
}
