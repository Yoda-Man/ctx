/**
 * Vector Store Types
 *
 * Core interfaces for the RAG vector storage system.
 * All vector stores must implement the VectorStore interface.
 */

// ============================================================================
// Chunk Types
// ============================================================================

/**
 * Metadata associated with a text chunk.
 *
 * Common fields are strongly typed; chunkers can add custom fields
 * via the index signature.
 */
export interface ChunkMetadata {
  /** Start character index in original document */
  startIndex?: number;
  /** End character index in original document */
  endIndex?: number;
  /** Page number (for paginated documents) */
  pageNumber?: number;
  /** Section or heading this chunk belongs to */
  section?: string;
  /** Allow chunker-specific custom fields */
  [key: string]: unknown;
}

/**
 * A text chunk ready for embedding or already embedded.
 *
 * Chunks are the output of chunkers and input to embedding providers.
 */
export interface Chunk {
  /** Unique identifier for this chunk */
  id: string;
  /** The text content of the chunk */
  content: string;
  /** Chunk metadata (position, page, custom fields) */
  metadata: ChunkMetadata;
  /** ID of the source document */
  documentId?: string;
}

/**
 * A chunk with its embedding vector.
 *
 * This is the input format for vector stores.
 */
export interface ChunkWithEmbedding extends Chunk {
  /** The embedding vector (should be normalized) */
  embedding: number[] | Float32Array;
}

// ============================================================================
// Search Types
// ============================================================================

/**
 * Metadata filter operators for querying.
 */
export type FilterOperator =
  | { $in: (string | number | boolean)[] }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $ne: string | number | boolean };

/**
 * Metadata filter for search queries.
 *
 * Supports equality checks and operators:
 * - Direct value: exact match
 * - $in: value in array
 * - $gt, $gte, $lt, $lte: numeric comparisons
 * - $ne: not equal
 *
 * @example
 * ```typescript
 * const filter: MetadataFilter = {
 *   documentId: 'doc-123',           // exact match
 *   pageNumber: { $gte: 5 },         // page >= 5
 *   category: { $in: ['tech', 'ai'] } // category is tech or ai
 * };
 * ```
 */
export type MetadataFilter = {
  [key: string]: string | number | boolean | FilterOperator;
};

/**
 * Options for similarity search.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 10) */
  topK?: number;
  /** Minimum similarity score threshold (0-1 for cosine) */
  minScore?: number;
  /** Filter results by metadata */
  filter?: MetadataFilter;
  /** Include full metadata in results (default: true) */
  includeMetadata?: boolean;
  /** Include embedding vectors in results (default: false) */
  includeVectors?: boolean;
}

/**
 * A single search result with similarity score.
 */
export interface SearchResult {
  /** Chunk ID */
  id: string;
  /** Similarity score (higher = more similar) */
  score: number;
  /** The matched chunk */
  chunk: Chunk;
  /** The embedding vector (if includeVectors was true) */
  embedding?: number[];
}

// ============================================================================
// Vector Store Configuration
// ============================================================================

/**
 * Distance metric for similarity computation.
 *
 * - cosine: Angle-based, ignores magnitude (most common for text)
 * - euclidean: Straight-line distance
 * - dotProduct: For pre-normalized vectors (fastest)
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotProduct';

/**
 * Configuration for vector stores.
 */
export interface VectorStoreConfig {
  /** Dimension of embedding vectors */
  dimensions: number;
  /** Distance metric for similarity (default: 'cosine') */
  distanceMetric?: DistanceMetric;
}

// ============================================================================
// Vector Store Interface
// ============================================================================

/**
 * Interface for vector stores.
 *
 * Vector stores are responsible for:
 * 1. Storing chunks with their embeddings (insert, upsert)
 * 2. Searching by vector similarity (search)
 * 3. Managing stored data (delete, count, clear)
 *
 * @example
 * ```typescript
 * const store: VectorStore = new PgVectorStore({
 *   dimensions: 1536,
 *   distanceMetric: 'cosine'
 * });
 *
 * // Insert chunks with embeddings
 * const ids = await store.insert(chunksWithEmbeddings);
 *
 * // Search for similar chunks
 * const results = await store.search(queryEmbedding, {
 *   topK: 5,
 *   minScore: 0.7,
 *   filter: { documentId: 'doc-123' }
 * });
 * ```
 */
export interface VectorStore {
  /** Human-readable name of this store */
  readonly name: string;

  /** Dimension of vectors this store accepts */
  readonly dimensions: number;

  /**
   * Insert chunks with embeddings into the store.
   *
   * @param chunks - Chunks with their embedding vectors
   * @returns Array of inserted chunk IDs
   * @throws {VectorStoreError} If insert fails or dimensions mismatch
   */
  insert(chunks: ChunkWithEmbedding[]): Promise<string[]>;

  /**
   * Insert or update chunks (update if ID exists).
   *
   * @param chunks - Chunks with their embedding vectors
   * @returns Array of upserted chunk IDs
   * @throws {VectorStoreError} If upsert fails or dimensions mismatch
   */
  upsert(chunks: ChunkWithEmbedding[]): Promise<string[]>;

  /**
   * Search for similar chunks by query vector.
   *
   * @param query - Query embedding vector
   * @param options - Search options (topK, minScore, filter)
   * @returns Array of search results sorted by similarity (descending)
   * @throws {VectorStoreError} If search fails or query dimensions mismatch
   */
  search(query: number[], options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Delete chunks by their IDs.
   *
   * Silently ignores IDs that don't exist.
   *
   * @param ids - Array of chunk IDs to delete
   * @throws {VectorStoreError} If delete fails
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Get the number of chunks in the store.
   *
   * @returns Total count of stored chunks
   */
  count(): Promise<number>;

  /**
   * Remove all chunks from the store.
   *
   * @throws {VectorStoreError} If clear fails
   */
  clear(): Promise<void>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for vector store failures.
 */
export type VectorStoreErrorCode =
  | 'DIMENSION_MISMATCH'
  | 'CHUNK_NOT_FOUND'
  | 'STORE_UNAVAILABLE'
  | 'INVALID_QUERY'
  | 'INVALID_FILTER'
  | 'INSERT_FAILED'
  | 'DELETE_FAILED'
  | 'STORE_ERROR';

/**
 * Details about a vector store error.
 */
export interface VectorStoreErrorDetails {
  /** Machine-readable error code */
  code: VectorStoreErrorCode;
  /** Name of the store that failed */
  storeName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
