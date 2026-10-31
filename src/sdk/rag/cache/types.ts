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
 * Configuration for LRU cache provider.
 */
export interface LRUCacheConfig {
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
}
