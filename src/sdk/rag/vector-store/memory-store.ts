/**
 * In-Memory Vector Store
 *
 * Vector store with exact brute-force search: a scan of every vector.
 *
 * Memory Management (NFR-103):
 * - Float32Array storage for 50% memory savings (default enabled)
 * - Optional memory budget with LRU eviction
 * - Memory usage tracking and reporting
 */

import type {
  ChunkWithEmbedding,
  SearchOptions,
  SearchResult,
  Chunk,
  InMemoryVectorStoreConfig,
  EvictionCallback,
} from './types.js';
import { BaseVectorStore } from './base-store.js';
import { BYTES_PER_FLOAT32, BYTES_PER_FLOAT64 } from '../memory/types.js';

/**
 * Internal storage format for chunks.
 *
 * Embeddings can be stored as Float32Array (efficient) or number[] (compatible).
 */
interface StoredChunk {
  chunk: Chunk;
  /** Embedding stored as Float32Array or number[] depending on config */
  embedding: Float32Array | number[];
  /** Timestamp for LRU eviction (Date.now()) */
  insertedAt: number;
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

  // ==========================================================================
  // Memory Management (NFR-103)
  // ==========================================================================

  /** Use Float32Array for embedding storage (50% memory savings) */
  private readonly useFloat32: boolean;

  /** Maximum memory budget in bytes (0 = unlimited) */
  private readonly maxMemoryBytes: number;

  /** Callback fired on eviction */
  private readonly onEviction: EvictionCallback | undefined;

  /** Current tracked memory usage in bytes */
  private currentMemoryBytes: number = 0;

  /** Bytes per float based on storage format */
  private readonly bytesPerFloat: number;

  constructor(config: InMemoryVectorStoreConfig) {
    super(config);

    // Memory management configuration
    this.useFloat32 = config.useFloat32 ?? true; // Default: enabled for 50% savings
    this.maxMemoryBytes = config.maxMemoryBytes ?? 0; // Default: no limit
    this.onEviction = config.onEviction;
    this.bytesPerFloat = this.useFloat32 ? BYTES_PER_FLOAT32 : BYTES_PER_FLOAT64;
  }

  /**
   * Insert chunks into the store.
   *
   * Generates IDs for chunks without them.
   * Enforces memory budget with LRU eviction if configured.
   */
  protected _insert = async (
    chunks: ChunkWithEmbedding[]
  ): Promise<string[]> => {
    const ids: string[] = [];

    // Calculate memory needed for this batch
    const bytesNeeded = chunks.length * this.dimensions * this.bytesPerFloat;

    // Enforce memory budget if configured
    if (this.maxMemoryBytes > 0) {
      this.evictIfNeeded(bytesNeeded);
    }

    for (const chunk of chunks) {
      const id = chunk.id || this.generateId();

      // Store chunk without embedding in the chunk object
      const { embedding, ...chunkWithoutEmbedding } = chunk;

      // Convert to Float32Array if enabled (50% memory savings)
      const storedEmbedding = this.useFloat32
        ? new Float32Array(embedding)
        : embedding;

      const storedChunk: StoredChunk = {
        chunk: { ...chunkWithoutEmbedding, id },
        embedding: storedEmbedding,
        insertedAt: Date.now(),
      };

      // Track memory for new entries (handle updates)
      const existing = this.store.get(id);
      if (existing) {
        // Update: release old memory
        this.currentMemoryBytes -= this.getEmbeddingBytes(existing.embedding);
      }

      this.store.set(id, storedChunk);
      this.currentMemoryBytes += this.getEmbeddingBytes(storedEmbedding);


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

      // Compute similarity score
      // Note: computeScore expects number[], so convert Float32Array if needed
      const embeddingArray = this.toNumberArray(stored.embedding);
      const score = this.computeScore(query, embeddingArray);

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

      // Optionally include embedding (convert to number[] for API compatibility)
      if (options.includeVectors) {
        result.embedding = this.toNumberArray(stored.embedding);
      }

      results.push(result);
    }

    // Sort by score descending and limit to topK
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, options.topK);
  };

  /**
   * Delete chunks by ID.
   *
   * Releases tracked memory for deleted chunks.
   */
  protected _delete = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      const existing = this.store.get(id);
      if (existing) {
        // Release memory tracking
        this.currentMemoryBytes -= this.getEmbeddingBytes(existing.embedding);
        this.store.delete(id);
      }
    }
  };

  /**
   * Get the number of stored chunks.
   */
  count = async (): Promise<number> => {
    return this.store.size;
  };

  /**
   * Remove all chunks from the store.
   *
   * Resets memory tracking to zero.
   */
  clear = async (): Promise<void> => {
    this.store.clear();
    this.currentMemoryBytes = 0;
  };

  // ==========================================================================
  // Private Memory Helpers
  // ==========================================================================

  /**
   * Get byte size of an embedding.
   */
  private getEmbeddingBytes(embedding: Float32Array | number[]): number {
    if (embedding instanceof Float32Array) {
      return embedding.byteLength;
    }
    return embedding.length * BYTES_PER_FLOAT64;
  }

  /**
   * Evict oldest entries if memory budget would be exceeded.
   *
   * Uses LRU policy (oldest insertedAt first).
   */
  private evictIfNeeded(bytesNeeded: number): void {
    const targetUsage = this.maxMemoryBytes - bytesNeeded;

    // No eviction needed if we have room
    if (this.currentMemoryBytes <= targetUsage) {
      return;
    }

    // Sort by insertedAt (oldest first) for LRU eviction
    const entries = Array.from(this.store.entries()).sort(
      (a, b) => a[1].insertedAt - b[1].insertedAt
    );

    const evictedIds: string[] = [];
    let freedBytes = 0;

    // Evict until we have room
    for (const [id, stored] of entries) {
      if (this.currentMemoryBytes - freedBytes <= targetUsage) {
        break;
      }

      const bytes = this.getEmbeddingBytes(stored.embedding);
      freedBytes += bytes;
      evictedIds.push(id);

      this.store.delete(id);
    }

    // Update memory tracking
    this.currentMemoryBytes -= freedBytes;

    // Fire callback if items were evicted
    if (evictedIds.length > 0 && this.onEviction) {
      this.onEviction(evictedIds, freedBytes);
    }
  }

  /**
   * Convert stored embedding to number[] for API compatibility.
   *
   * Used when returning embeddings in search results.
   */
  private toNumberArray(embedding: Float32Array | number[]): number[] {
    if (embedding instanceof Float32Array) {
      return Array.from(embedding);
    }
    return embedding;
  }
}
