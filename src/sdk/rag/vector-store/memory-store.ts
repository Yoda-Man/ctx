/**
 * In-Memory Vector Store
 *
 * Vector store with exact brute-force search: a scan of every vector,
 * stored as Float32Array (half the memory of number[]).
 */

import type {
  ChunkWithEmbedding,
  SearchOptions,
  SearchResult,
  Chunk,
  VectorStoreConfig,
} from './types.js';
import { BaseVectorStore } from './base-store.js';

interface StoredChunk {
  chunk: Chunk;
  embedding: Float32Array;
}

/**
 * In-memory vector store with exact search and metadata filtering.
 *
 * @example
 * ```typescript
 * const store = new InMemoryVectorStore({ dimensions: 1536 });
 *
 * await store.insert([
 *   { id: 'chunk-1', content: 'Hello', embedding: [...], metadata: {} }
 * ]);
 *
 * const results = await store.search(queryVector, { topK: 5 });
 * ```
 */
export class InMemoryVectorStore extends BaseVectorStore {
  readonly name = 'InMemoryVectorStore';

  /** Internal storage: id -> chunk with embedding */
  private store: Map<string, StoredChunk> = new Map();

  constructor(config: VectorStoreConfig) {
    super(config);
  }

  /**
   * Insert chunks into the store.
   *
   * Generates IDs for chunks without them.
   */
  protected _insert = async (
    chunks: ChunkWithEmbedding[]
  ): Promise<string[]> => {
    const ids: string[] = [];

    for (const chunk of chunks) {
      const id = chunk.id || this.generateId();
      const { embedding, ...chunkWithoutEmbedding } = chunk;
      // Always a copy: the caller's array may be a view over a database buffer
      this.store.set(id, { chunk: { ...chunkWithoutEmbedding, id }, embedding: new Float32Array(embedding) });
      ids.push(id);
    }

    return ids;
  };

  /**
   * Upsert chunks (insert or update).
   *
   * If a chunk with the same ID exists, it's replaced.
   */
  protected override _upsert = async (
    chunks: ChunkWithEmbedding[]
  ): Promise<string[]> => {
    // For in-memory store, upsert is the same as insert
    // (Map.set overwrites existing keys)
    return this._insert(chunks);
  };

  /**
   * Search for similar chunks.
   *
   * Scans all vectors for exact results. O(n) complexity.
   */
  protected _search = async (
    query: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> => {
    return this.searchBruteForce(query, options);
  };

  /**
   * Brute-force search (original implementation).
   *
   * Scans all vectors for exact results. O(n) complexity.
   */
  private searchBruteForce = async (
    query: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> => {
    const results: SearchResult[] = [];

    for (const [id, stored] of this.store) {
      // Apply metadata filter first (cheaper than computing similarity)
      if (options.filter) {
        if (!this.matchesFilter(stored.chunk.metadata, options.filter)) {
          continue;
        }
      }

      // Scored on the stored Float32Array: copying it to number[] first cost
      // every vector an allocation on every search
      const score = this.computeScore(query, stored.embedding);

      // Apply minimum score threshold
      if (options.minScore !== undefined && score < options.minScore) {
        continue;
      }

      // Build result
      const result: SearchResult = {
        id,
        score,
        chunk: options.includeMetadata
          ? stored.chunk
          : { ...stored.chunk, metadata: {} },
      };

      // Optionally include embedding (number[] for API compatibility)
      if (options.includeVectors) {
        result.embedding = Array.from(stored.embedding);
      }

      results.push(result);
    }

    // Sort by score descending and limit to topK
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, options.topK);
  };

  /**
   * Delete chunks by ID.
   */
  protected _delete = async (ids: string[]): Promise<void> => {
    for (const id of ids) this.store.delete(id);
  };

  /**
   * Get the number of stored chunks.
   */
  count = async (): Promise<number> => {
    return this.store.size;
  };

  /**
   * Remove all chunks from the store.
   */
  clear = async (): Promise<void> => {
    this.store.clear();
  };
}
