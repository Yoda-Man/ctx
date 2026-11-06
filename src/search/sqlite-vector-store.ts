/**
 * Vector search answered by SQLite, over the embeddings in the chunks table.
 *
 * sqlite-vec's vec_distance_cosine() scores every chunk of a project in C,
 * reading the stored float32 vectors from disk: an exact scan, the same
 * results as scanning vectors held in memory, without loading them first.
 * Measured on synthetic projects: 0.48 s a query at 100,000 chunks and 0.94 s
 * at 200,000, holding under 20 MB, where loading the vectors into memory took
 * seconds and about 4 KB a chunk before the first query.
 *
 * Read-only: chunks are written by the indexer (database/operations.ts).
 */

import type Database from 'better-sqlite3';

import type {
  ChunkWithEmbedding,
  MetadataFilter,
  SearchOptions,
  SearchResult,
  VectorStore,
} from '../sdk/rag/index.js';
import { ChunkLoadNoEmbeddingSchema, validateRows } from '../database/validation.js';
import { safeJsonParse, type Logger, consoleLogger } from '../utils/index.js';

/** Chunk metadata a vector search can filter on, and its column. */
const FILTER_COLUMNS: Record<string, string> = {
  fileType: 'file_type',
  language: 'language',
  projectId: 'project_id',
};

/**
 * Whether this connection can score vectors in SQL (sqlite-vec loaded; see
 * registerSqlFunctions in database/connection.ts).
 */
export function hasSqlVectorSearch(db: Database.Database): boolean {
  try {
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}

export class SqliteVectorStore implements VectorStore {
  readonly name = 'SqliteVectorStore';

  constructor(
    private readonly db: Database.Database,
    private readonly projectId: string,
    readonly dimensions: number,
    private readonly logger: Logger = consoleLogger
  ) {}

  /** Chunks in the project. */
  count = async (): Promise<number> =>
    (this.db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE project_id = ?').get(this.projectId) as { count: number })
      .count;

  /**
   * The topK chunks most similar to the query (cosine similarity, 1 is
   * identical), best first. `filter` matches fileType, language and projectId
   * (a value, or { $in: [...] }) before the topK cut.
   */
  search = async (query: number[], options: SearchOptions = {}): Promise<SearchResult[]> => {
    if (query.length !== this.dimensions) {
      throw new Error(`Query has ${query.length} dimensions; this project's vectors have ${this.dimensions}`);
    }
    const params: unknown[] = [Buffer.from(new Float32Array(query).buffer), this.projectId];
    const where = this.filterSql(options.filter, params);
    params.push(options.topK ?? 10);

    let rows: Array<Record<string, unknown> & { score: number; embedding?: Buffer }>;
    try {
      rows = this.db
        .prepare(
          `SELECT id, content, file_path, file_type, language, start_line, end_line, metadata,
                  1 - vec_distance_cosine(embedding, ?) AS score${options.includeVectors ? ', embedding' : ''}
           FROM chunks
           WHERE project_id = ?${where}
           ORDER BY score DESC
           LIMIT ?`
        )
        .all(...params) as typeof rows;
    } catch (error) {
      // vec_distance_cosine refuses vectors of different sizes
      if (/dimension/i.test(String(error))) {
        throw new Error(
          `Embedding dimension mismatch in project ${this.projectId}: expected ${this.dimensions} dimensions. ` +
            `This project may have been indexed with a different embedding model. ` +
            `Re-index with: ctx index <path> --force`
        );
      }
      throw error;
    }

    const chunks = validateRows(ChunkLoadNoEmbeddingSchema, rows, `chunks.project_id=${this.projectId}`);
    const includeMetadata = options.includeMetadata ?? true;
    return chunks
      .map((row, i) => {
        const result: SearchResult = {
          id: row.id,
          score: rows[i]!.score,
          chunk: {
            id: row.id,
            content: row.content,
            metadata: includeMetadata
              ? {
                  projectId: this.projectId,
                  filePath: row.file_path,
                  fileType: row.file_type,
                  language: row.language,
                  startLine: row.start_line,
                  endLine: row.end_line,
                  ...safeJsonParse(row.metadata, {}, (err) => {
                    this.logger.warn(`[VectorStore] Skipping corrupted metadata for chunk ${row.id}: ${err.message}`);
                  }),
                }
              : {},
          },
        };
        const blob = rows[i]!.embedding;
        if (blob) result.embedding = Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
        return result;
      })
      .filter((result) => options.minScore === undefined || result.score >= options.minScore);
  };

  private filterSql(filter: MetadataFilter | undefined, params: unknown[]): string {
    let sql = '';
    for (const [key, condition] of Object.entries(filter ?? {})) {
      const column = FILTER_COLUMNS[key];
      if (!column) throw new Error(`Vector search cannot filter on "${key}"`);
      const values = typeof condition === 'object' && condition !== null && '$in' in condition ? condition.$in : [condition];
      if (!Array.isArray(values)) throw new Error(`Unsupported filter on "${key}"`);
      sql += ` AND ${column} IN (${values.map(() => '?').join(', ')})`;
      params.push(...values);
    }
    return sql;
  }

  private readOnly = (): never => {
    throw new Error('SqliteVectorStore is read-only: chunks are written by the indexer');
  };

  insert = async (_chunks: ChunkWithEmbedding[]): Promise<string[]> => this.readOnly();
  upsert = async (_chunks: ChunkWithEmbedding[]): Promise<string[]> => this.readOnly();
  delete = async (_ids: string[]): Promise<void> => this.readOnly();
  clear = async (): Promise<void> => this.readOnly();
}
