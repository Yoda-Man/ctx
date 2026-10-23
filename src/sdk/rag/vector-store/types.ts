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
  embedding: number[];
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

// ============================================================================
// Store-Specific Configuration
// ============================================================================

// ============================================================================
// HNSW Configuration
// ============================================================================

/**
 * Configuration for HNSW (Hierarchical Navigable Small World) index.
 *
 * HNSW is an approximate nearest neighbor algorithm that achieves O(log n)
 * search time. Used by pgvector, Pinecone, Weaviate, and other production
 * vector databases.
 *
 * @example
 * ```typescript
 * const config: HNSWConfig = {
 *   M: 16,              // 16 connections per node
 *   efConstruction: 200, // Build quality
 *   efSearch: 100        // Search quality/speed tradeoff
 * };
 * ```
 */
export interface HNSWConfig {
  /**
   * Maximum number of bi-directional connections per node per layer.
   *
   * Higher M = better recall, more memory, slower insert.
   * - M=4-8: Low memory, good for small datasets
   * - M=12-16: Balanced (recommended)
   * - M=24-48: High recall, large datasets
   *
   * @default 16
   */
  M?: number;

  /**
   * Size of dynamic candidate list during construction.
   *
   * Higher efConstruction = better graph quality, slower insert.
   * - efConstruction=100: Fast construction
   * - efConstruction=200: Balanced (recommended)
   * - efConstruction=400: High quality graph
   *
   * @default 200
   */
  efConstruction?: number;

  /**
   * Size of dynamic candidate list during search.
   *
   * Higher efSearch = better recall, slower search.
   * Must be >= k (number of neighbors requested).
   * - efSearch=16-64: Fast search
   * - efSearch=100: Balanced (recommended)
   * - efSearch=200+: High recall
   *
   * @default 100
   */
  efSearch?: number;
}

/**
 * Index type for InMemoryVectorStore.
 *
 * - 'brute-force': O(n) linear scan (default, exact results)
 * - 'hnsw': O(log n) HNSW index (approximate, much faster for large datasets)
 */
export type InMemoryIndexType = 'brute-force' | 'hnsw';

/**
 * Callback fired when embeddings are evicted due to memory pressure.
 *
 * @param ids - IDs of evicted chunks
 * @param freedBytes - Approximate bytes freed
 */
export type EvictionCallback = (ids: string[], freedBytes: number) => void;

/**
 * Configuration for in-memory vector store.
 *
 * Extends base VectorStoreConfig with HNSW indexing and memory management options.
 *
 * @example
 * ```typescript
 * // Default brute-force (exact, suitable for <10K vectors)
 * const store = new InMemoryVectorStore({ dimensions: 1536 });
 *
 * // HNSW index (approximate, suitable for 10K-100K+ vectors)
 * const store = new InMemoryVectorStore({
 *   dimensions: 1536,
 *   indexType: 'hnsw',
 *   hnswConfig: { M: 16, efSearch: 100 }
 * });
 *
 * // Memory-efficient storage with budget enforcement
 * const store = new InMemoryVectorStore({
 *   dimensions: 1536,
 *   useFloat32: true,           // 50% memory savings
 *   maxMemoryBytes: 50 * 1024 * 1024, // 50MB budget
 *   onEviction: (ids, bytes) => {
 *     console.log(`Evicted ${ids.length} chunks, freed ${bytes} bytes`);
 *   }
 * });
 * ```
 */
export interface InMemoryVectorStoreConfig extends VectorStoreConfig {
  /**
   * Index type to use for similarity search.
   *
   * - 'brute-force': Linear scan, O(n), exact results (default)
   * - 'hnsw': HNSW index, O(log n), approximate results
   *
   * @default 'brute-force'
   */
  indexType?: InMemoryIndexType;

  /**
   * HNSW configuration (only used when indexType is 'hnsw').
   *
   * Defaults are tuned for balanced recall/speed.
   */
  hnswConfig?: HNSWConfig;

  // ==========================================================================
  // Memory Management Options (NFR-103)
  // ==========================================================================

  /**
   * Use Float32Array for embedding storage instead of number[].
   *
   * Float32Array uses 4 bytes per float vs 8 bytes for number[],
   * providing 50% memory savings with negligible accuracy loss
   * for typical embedding use cases.
   *
   * @default true
   */
  useFloat32?: boolean;

  /**
   * Maximum memory budget in bytes for embedding storage.
   *
   * When exceeded, oldest entries are evicted (LRU policy).
   * Set to 0 or undefined for no limit.
   *
   * @example
   * ```typescript
   * // 100MB budget (NFR-103 requirement)
   * maxMemoryBytes: 100 * 1024 * 1024
   * ```
   */
  maxMemoryBytes?: number;

  /**
   * Callback fired when entries are evicted due to memory pressure.
   *
   * Useful for logging, metrics, or cascading cleanup.
   */
  onEviction?: EvictionCallback;
}

/**
 * Configuration for PostgreSQL pgvector store.
 *
 * Requires either `connectionString` or `pool` to be provided.
 *
 * @example
 * ```typescript
 * const store = new PgVectorStore({
 *   dimensions: 1536,
 *   connectionString: 'postgresql://user:pass@localhost:5432/mydb',
 *   tableName: 'embeddings',
 * });
 * ```
 */
export interface PgVectorStoreConfig extends VectorStoreConfig {
  /** PostgreSQL connection string (e.g., 'postgresql://user:pass@localhost:5432/db') */
  connectionString?: string;
  /** Existing pg Pool instance (alternative to connectionString) */
  pool?: unknown; // Type as unknown to avoid pg dependency in types
  /** Table name for storing vectors (default: 'vector_chunks') */
  tableName?: string;
  /** Schema name (default: 'public') */
  schemaName?: string;
  /** Index type for similarity search (default: 'hnsw') */
  indexType?: 'hnsw' | 'ivfflat' | 'none';
  /** HNSW index: max connections per node (default: 16) */
  hnswM?: number;
  /** HNSW index: size of dynamic candidate list during construction (default: 64) */
  hnswEfConstruction?: number;
  /** Max pool connections when using connectionString (default: 10) */
  maxConnections?: number;
  /** Idle connection timeout in ms (default: 30000) */
  idleTimeoutMs?: number;
}

/**
 * Configuration for ChromaDB vector store.
 *
 * @example
 * ```typescript
 * // Embedded mode (local file storage)
 * const store = new ChromaVectorStore({
 *   dimensions: 1536,
 *   mode: 'embedded',
 *   persistPath: './chroma_data',
 * });
 *
 * // Server mode (connect to Chroma server)
 * const store = new ChromaVectorStore({
 *   dimensions: 1536,
 *   mode: 'server',
 *   serverUrl: 'http://localhost:8000',
 * });
 * ```
 */
export interface ChromaVectorStoreConfig extends VectorStoreConfig {
  /** Collection name (default: 'default_collection') */
  collectionName?: string;
  /** Client mode: 'embedded' for local file, 'server' for HTTP (default: 'embedded') */
  mode?: 'embedded' | 'server';
  /** Chroma server URL for server mode (default: 'http://localhost:8000') */
  serverUrl?: string;
  /** Local storage path for embedded mode (default: './chroma_data') */
  persistPath?: string;
  /** Optional authentication for server mode */
  auth?: {
    provider: 'token' | 'basic';
    credentials: string;
  };
}
