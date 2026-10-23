/**
 * Generic cache provider interface.
 *
 * All methods are async to support both in-memory and external cache backends
 * (Redis, Memcached, IndexedDB, etc.).
 *
 * @typeParam T - The type of values stored in the cache. Defaults to `unknown`.
 *
 * @example
 * ```typescript
 * // Type-safe embedding cache
 * const cache: CacheProvider<number[]> = new LRUCacheProvider({ maxSize: 1000 });
 *
 * // Generic cache (requires type assertion on get)
 * const genericCache: CacheProvider = new LRUCacheProvider();
 * ```
 */
export interface CacheProvider<T = unknown> {
  /**
   * Retrieve a value from the cache.
   * @param key - The cache key
   * @returns The cached value, or `undefined` if not found or expired
   */
  get(key: string): Promise<T | undefined>;

  /**
   * Store a value in the cache.
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttl - Optional time-to-live in milliseconds
   */
  set(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Remove a value from the cache.
   * @param key - The cache key
   * @returns `true` if the key existed and was deleted, `false` otherwise
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists in the cache (and is not expired).
   * @param key - The cache key
   */
  has(key: string): Promise<boolean>;

  /**
   * Remove all entries from the cache.
   */
  clear(): Promise<void>;
}

/**
 * Cache statistics for monitoring and debugging.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current number of entries in the cache */
  size: number;
  /** Hit rate as a decimal (0-1). Returns 0 if no requests yet. */
  hitRate: number;
  /** Current memory usage in bytes (only if maxMemoryBytes is set) */
  memoryUsage?: number;
  /** Maximum memory budget in bytes (only if maxMemoryBytes is set) */
  maxMemoryBytes?: number;
}

/**
 * Function to estimate the memory size of a cached value.
 *
 * @param value - The value to estimate size for
 * @returns Estimated size in bytes
 */
export type SizeEstimator<T> = (value: T) => number;

/**
 * Configuration for LRU cache provider.
 */
export interface LRUCacheConfig<T = unknown> {
  /**
   * Maximum number of entries in the cache.
   * When exceeded, least-recently-used entries are evicted.
   * @default 10000
   */
  maxSize?: number;

  /**
   * Default time-to-live in milliseconds.
   * Individual `set()` calls can override this.
   * If not set, entries never expire (only evicted by LRU).
   */
  defaultTtl?: number;

  // ==========================================================================
  // Memory-Based Limits (NFR-103)
  // ==========================================================================

  /**
   * Maximum memory budget in bytes.
   *
   * When set, eviction is based on memory usage instead of entry count.
   * Requires `estimateSize` to be provided.
   *
   * @example
   * ```typescript
   * // 50MB cache for embeddings
   * const cache = new LRUCacheProvider<number[]>({
   *   maxMemoryBytes: 50 * 1024 * 1024,
   *   estimateSize: (embedding) => embedding.length * 8,
   * });
   * ```
   */
  maxMemoryBytes?: number;

  /**
   * Function to estimate the memory size of cached values.
   *
   * Required when `maxMemoryBytes` is set.
   * Should return size in bytes.
   *
   * @example
   * ```typescript
   * // For embedding arrays
   * estimateSize: (embedding) => embedding.length * 8
   *
   * // For strings
   * estimateSize: (str) => str.length * 2
   * ```
   */
  estimateSize?: SizeEstimator<T>;
}
