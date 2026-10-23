/**
 * Base Vector Store
 *
 * Abstract class providing common functionality for all vector stores.
 */

import type {
  VectorStore,
  VectorStoreConfig,
  ChunkWithEmbedding,
  SearchOptions,
  SearchResult,
  DistanceMetric,
  MetadataFilter,
  FilterOperator,
  ChunkMetadata,
} from './types.js';
import { VectorStoreError } from './errors.js';
import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
} from '../embeddings/utils.js';

/**
 * Abstract base class for vector stores.
 *
 * Provides:
 * - Input validation (dimensions, empty arrays)
 * - Metadata filtering logic
 * - Similarity score computation
 * - Consistent error handling
 *
 * Subclasses must implement:
 * - `_insert()` - Store-specific insertion
 * - `_search()` - Store-specific similarity search
 * - `_delete()` - Store-specific deletion
 * - `count()` - Return total chunk count
 * - `clear()` - Remove all chunks
 *
 * @example
 * ```typescript
 * class PgVectorStore extends BaseVectorStore {
 *   readonly name = 'PgVectorStore';
 *
 *   constructor(connectionString: string, config: VectorStoreConfig) {
 *     super(config);
 *     this.db = new Pool({ connectionString });
 *   }
 *
 *   protected async _insert(chunks: ChunkWithEmbedding[]): Promise<string[]> {
 *     // PostgreSQL-specific insertion logic
 *   }
 *
 *   // ... other abstract methods
 * }
 * ```
 */
export abstract class BaseVectorStore implements VectorStore {
  /** Human-readable name of this store */
  abstract readonly name: string;

  /** Dimension of vectors this store accepts */
  readonly dimensions: number;

  /** Distance metric for similarity computation */
  protected readonly distanceMetric: DistanceMetric;

  constructor(config: VectorStoreConfig) {
    this.dimensions = config.dimensions;
    this.distanceMetric = config.distanceMetric ?? 'cosine';
  }

  /**
   * Insert chunks with embeddings into the store.
   *
   * Validates dimensions before delegating to store-specific implementation.
   */
  insert = async (chunks: ChunkWithEmbedding[]): Promise<string[]> => {
    if (chunks.length === 0) {
      return [];
    }

    this.validateChunks(chunks);
    return this._insert(chunks);
  };

  /**
   * Insert or update chunks (update if ID exists).
   *
   * Default implementation uses _insert with upsert semantics.
   * Subclasses may override for native upsert support.
   */
  upsert = async (chunks: ChunkWithEmbedding[]): Promise<string[]> => {
    if (chunks.length === 0) {
      return [];
    }

    this.validateChunks(chunks);
    return this._upsert(chunks);
  };

  /**
   * Search for similar chunks by query vector.
   *
   * Validates query dimensions before delegating to store-specific implementation.
   */
  search = async (
    query: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> => {
    this.validateQuery(query);

    const opts: SearchOptions = {
      topK: options?.topK ?? 10,
      minScore: options?.minScore,
      filter: options?.filter,
      includeMetadata: options?.includeMetadata ?? true,
      includeVectors: options?.includeVectors ?? false,
    };

    return this._search(query, opts);
  };

  /**
   * Delete chunks by their IDs.
   *
   * Silently ignores IDs that don't exist.
   */
  delete = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) {
      return;
    }

    return this._delete(ids);
  };

  /**
   * Get the number of chunks in the store.
   */
  abstract count(): Promise<number>;

  /**
   * Remove all chunks from the store.
   */
  abstract clear(): Promise<void>;

  // ===========================================================================
  // Protected Abstract Methods (Subclass Implements)
  // ===========================================================================

  /**
   * Store-specific insertion logic.
   *
   * @param chunks - Validated chunks with embeddings
   * @returns Array of inserted chunk IDs
   */
  protected abstract _insert(chunks: ChunkWithEmbedding[]): Promise<string[]>;

  /**
   * Store-specific upsert logic.
   *
   * Default implementation delegates to _insert.
   * Subclasses should override for native upsert support.
   *
   * @param chunks - Validated chunks with embeddings
   * @returns Array of upserted chunk IDs
   */
  protected _upsert = async (
    chunks: ChunkWithEmbedding[]
  ): Promise<string[]> => {
    // Default: delegate to insert (subclasses override for true upsert)
    return this._insert(chunks);
  };

  /**
   * Store-specific search logic.
   *
   * @param query - Validated query vector
   * @param options - Search options with defaults applied
   * @returns Array of search results sorted by similarity
   */
  protected abstract _search(
    query: number[],
    options: SearchOptions
  ): Promise<SearchResult[]>;

  /**
   * Store-specific deletion logic.
   *
   * @param ids - Non-empty array of chunk IDs to delete
   */
  protected abstract _delete(ids: string[]): Promise<void>;

  // ===========================================================================
  // Protected Helper Methods
  // ===========================================================================

  /**
   * Validate chunks before insertion.
   *
   * @throws {VectorStoreError} If any chunk has wrong dimensions
   */
  protected validateChunks(chunks: ChunkWithEmbedding[]): void {
    for (const chunk of chunks) {
      if (chunk.embedding.length !== this.dimensions) {
        throw VectorStoreError.dimensionMismatch(
          this.name,
          this.dimensions,
          chunk.embedding.length
        );
      }
    }
  }

  /**
   * Validate query vector before search.
   *
   * @throws {VectorStoreError} If query has wrong dimensions or is empty
   */
  protected validateQuery(query: number[]): void {
    if (query.length === 0) {
      throw VectorStoreError.invalidQuery(this.name, 'query vector is empty');
    }

    if (query.length !== this.dimensions) {
      throw VectorStoreError.dimensionMismatch(
        this.name,
        this.dimensions,
        query.length
      );
    }
  }

  /**
   * Compute similarity score between two vectors.
   *
   * Higher scores indicate more similarity for all metrics.
   */
  protected computeScore(a: number[], b: number[]): number {
    switch (this.distanceMetric) {
      case 'cosine':
        return cosineSimilarity(a, b);
      case 'dotProduct':
        return dotProduct(a, b);
      case 'euclidean':
        // Convert distance to similarity (closer = higher score)
        // Using 1 / (1 + distance) to normalize to (0, 1]
        return 1 / (1 + euclideanDistance(a, b));
      default:
        return cosineSimilarity(a, b);
    }
  }

  /**
   * Check if metadata matches a filter.
   *
   * @param metadata - Chunk metadata to check
   * @param filter - Filter criteria
   * @returns true if metadata matches all filter conditions
   */
  protected matchesFilter(
    metadata: ChunkMetadata,
    filter: MetadataFilter
  ): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      const value = metadata[key];

      // Handle operator objects
      if (this.isFilterOperator(condition)) {
        if (!this.evaluateOperator(value, condition)) {
          return false;
        }
      } else {
        // Direct equality check
        if (value !== condition) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a value is a filter operator object.
   */
  private isFilterOperator(value: unknown): value is FilterOperator {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const keys = Object.keys(value);
    return (
      keys.length === 1 &&
      ['$in', '$gt', '$gte', '$lt', '$lte', '$ne'].includes(keys[0] as string)
    );
  }

  /**
   * Evaluate a filter operator against a value.
   */
  private evaluateOperator(value: unknown, operator: FilterOperator): boolean {
    if ('$in' in operator) {
      return operator.$in.includes(value as string | number | boolean);
    }

    if ('$ne' in operator) {
      return value !== operator.$ne;
    }

    // Numeric comparisons
    if (typeof value !== 'number') {
      return false;
    }

    if ('$gt' in operator) {
      return value > operator.$gt;
    }

    if ('$gte' in operator) {
      return value >= operator.$gte;
    }

    if ('$lt' in operator) {
      return value < operator.$lt;
    }

    if ('$lte' in operator) {
      return value <= operator.$lte;
    }

    return false;
  }

  /**
   * Generate a unique ID for a chunk.
   */
  protected generateId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
