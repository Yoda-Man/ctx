/**
 * In-Memory Vector Store
 *
 * Vector store implementation supporting both brute-force O(n) search
 * and HNSW O(log n) approximate search.
 *
 * - Brute-force (default): Exact results, suitable for <10K vectors
 * - HNSW: Approximate results, suitable for 10K-100K+ vectors
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
  HNSWConfig,
  EvictionCallback,
} from './types.js';
import { BaseVectorStore } from './base-store.js';
import { HNSWIndex } from './hnsw-index.js';
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
 * In-memory vector store supporting both brute-force and HNSW search.
 *
 * Features:
 * - No external dependencies
 * - Two search modes: brute-force (exact) and HNSW (approximate)
 * - Full metadata filtering support
 * - Brute-force: suitable for <10K vectors
 * - HNSW: suitable for 10K-100K+ vectors with <100ms latency
 *
 * @example
 * ```typescript
 * // Default brute-force mode
 * const store = new InMemoryVectorStore({ dimensions: 1536 });
 *
 * // HNSW mode for large datasets
 * const store = new InMemoryVectorStore({
 *   dimensions: 1536,
 *   indexType: 'hnsw',
 *   hnswConfig: { M: 16, efSearch: 100 }
 * });
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

  /** Index type: 'brute-force' or 'hnsw' */
  private readonly indexType: 'brute-force' | 'hnsw';

  /** HNSW index (only initialized when indexType is 'hnsw') */
  private hnswIndex: HNSWIndex | null = null;

  /** HNSW configuration */
  private readonly hnswConfig: HNSWConfig;

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
    this.indexType = config.indexType ?? 'brute-force';
    this.hnswConfig = config.hnswConfig ?? {};

    // Memory management configuration
    this.useFloat32 = config.useFloat32 ?? true; // Default: enabled for 50% savings
    this.maxMemoryBytes = config.maxMemoryBytes ?? 0; // Default: no limit
    this.onEviction = config.onEviction;
    this.bytesPerFloat = this.useFloat32 ? BYTES_PER_FLOAT32 : BYTES_PER_FLOAT64;

    // Initialize HNSW index if enabled
    if (this.indexType === 'hnsw') {
      this.hnswIndex = new HNSWIndex(config.dimensions, this.hnswConfig);
    }
  }

  /**
   * Insert chunks into the store.
   *
   * Generates IDs for chunks without them.
   * If HNSW index is enabled, also adds vectors to the index.
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

      // Add to HNSW index if enabled (HNSW uses number[])
      if (this.hnswIndex) {
        this.hnswIndex.insert(id, embedding);
      }

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
   * Uses HNSW index when enabled (O(log n)), otherwise brute-force (O(n)).
   */
  protected _search = async (
    query: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> => {
    // Use HNSW index if available
    if (this.hnswIndex) {
      return this.searchWithHNSW(query, options);
    }

    // Fall back to brute-force search
    return this.searchBruteForce(query, options);
  };

  /**
   * HNSW-accelerated search.
   *
   * Gets candidates from HNSW index, then applies metadata filtering
   * and score thresholds from the full chunk data.
   */
  private searchWithHNSW = async (
    query: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> => {
    // Over-fetch candidates to account for filtering
    // If we have filters, get more candidates since some will be filtered out
    const candidateMultiplier = options.filter ? 4 : 2;
    const candidateCount = Math.max(
      (options.topK ?? 10) * candidateMultiplier,
      50 // Minimum candidates for good recall
    );

    // Get candidate IDs from HNSW index
    const candidates = this.hnswIndex!.search(query, candidateCount);

    const results: SearchResult[] = [];

    for (const candidate of candidates) {
      const stored = this.store.get(candidate.id);
      if (!stored) {
        continue; // Should not happen, but be defensive
      }

      // Apply metadata filter
      if (options.filter) {
        if (!this.matchesFilter(stored.chunk.metadata, options.filter)) {
          continue;
        }
      }

      // Convert HNSW distance to similarity score
      // HNSW uses Euclidean distance, convert to similarity: 1 / (1 + distance)
      // But for better accuracy, recompute using the configured distance metric
      // Note: computeScore expects number[], so convert Float32Array if needed
      const embeddingArray = this.toNumberArray(stored.embedding);
      const score = this.computeScore(query, embeddingArray);

      // Apply minimum score threshold
      if (options.minScore !== undefined && score < options.minScore) {
        continue;
      }

      // Build result
      const result: SearchResult = {
        id: candidate.id,
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

    // Sort by score descending (HNSW returns by distance, we want similarity)
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, options.topK);
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
   * Also removes from HNSW index if enabled.
   * Releases tracked memory for deleted chunks.
   */
  protected _delete = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      const existing = this.store.get(id);
      if (existing) {
        // Release memory tracking
        this.currentMemoryBytes -= this.getEmbeddingBytes(existing.embedding);
        this.store.delete(id);

        // Remove from HNSW index if enabled
        if (this.hnswIndex) {
          this.hnswIndex.delete(id);
        }
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
   * Also clears HNSW index if enabled.
   * Resets memory tracking to zero.
   */
  clear = async (): Promise<void> => {
    this.store.clear();
    this.currentMemoryBytes = 0;

    // Clear HNSW index if enabled
    if (this.hnswIndex) {
      this.hnswIndex.clear();
    }
  };

  /**
   * Get the current index type.
   */
  getIndexType = (): 'brute-force' | 'hnsw' => {
    return this.indexType;
  };

  // ==========================================================================
  // Memory Management API (NFR-103)
  // ==========================================================================

  /**
   * Get current memory usage for embedding storage.
   *
   * @returns Memory usage in bytes
   */
  memoryUsage = (): number => {
    return this.currentMemoryBytes;
  };

  /**
   * Get memory usage statistics.
   *
   * @returns Object with usage details
   */
  getMemoryStats = (): {
    usedBytes: number;
    maxBytes: number;
    chunkCount: number;
    bytesPerChunk: number;
    percentUsed: number;
    useFloat32: boolean;
  } => {
    const chunkCount = this.store.size;
    const bytesPerChunk =
      chunkCount > 0 ? this.currentMemoryBytes / chunkCount : 0;
    const percentUsed =
      this.maxMemoryBytes > 0
        ? (this.currentMemoryBytes / this.maxMemoryBytes) * 100
        : 0;

    return {
      usedBytes: this.currentMemoryBytes,
      maxBytes: this.maxMemoryBytes,
      chunkCount,
      bytesPerChunk,
      percentUsed,
      useFloat32: this.useFloat32,
    };
  };

  /**
   * Check if storage is using Float32Array format.
   */
  isUsingFloat32 = (): boolean => {
    return this.useFloat32;
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

      // Remove from store and index
      this.store.delete(id);
      if (this.hnswIndex) {
        this.hnswIndex.delete(id);
      }
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
