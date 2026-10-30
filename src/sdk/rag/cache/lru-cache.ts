/**
 * LRU Cache Provider
 *
 * In-memory cache with Least Recently Used eviction and optional TTL.
 * A Map keeps insertion order, so the least recently used entry is the
 * first key: reading or writing an entry moves its key to the end.
 */

import type { CacheProvider, LRUCacheConfig } from './types.js';

interface Entry<T> {
  value: T;
  expiresAt: number | null; // null = never expires
}

/**
 * In-memory LRU (Least Recently Used) cache with optional TTL support.
 *
 * Eviction Policy:
 * - When cache reaches maxSize, the least recently accessed item is evicted
 * - Items are also evicted when their TTL expires (checked on access)
 *
 * @typeParam T - The type of values stored in the cache
 *
 * @example
 * ```typescript
 * const cache = new LRUCacheProvider<string>({ maxSize: 100 });
 * await cache.set('user:1', 'Alice');
 * const user = await cache.get('user:1'); // 'Alice'
 *
 * // With TTL (expires after 5 minutes)
 * const sessionCache = new LRUCacheProvider<Session>({
 *   maxSize: 1000,
 *   defaultTtl: 5 * 60 * 1000,
 * });
 * ```
 */
export class LRUCacheProvider<T = unknown> implements CacheProvider<T> {
  private readonly maxSize: number;
  private readonly defaultTtl: number | null;
  private readonly cache = new Map<string, Entry<T>>();

  constructor(config: LRUCacheConfig = {}) {
    this.maxSize = config.maxSize ?? 10000;
    this.defaultTtl = config.defaultTtl ?? null;
  }

  /**
   * Retrieve a value from the cache, marking it most recently used.
   * Expired entries are removed and reported as missing.
   */
  get = async (key: string): Promise<T | undefined> => {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Expires AT the TTL time, not after
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  };

  /**
   * Store a value, marking it most recently used and evicting the least
   * recently used entry when full.
   *
   * @param ttl - Optional TTL in milliseconds (overrides defaultTtl)
   */
  set = async (key: string, value: T, ttl?: number): Promise<void> => {
    const effectiveTtl = ttl ?? this.defaultTtl;
    this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { value, expiresAt: effectiveTtl !== null ? Date.now() + effectiveTtl : null });
  };

  /**
   * Remove a value from the cache.
   *
   * @returns `true` if the key existed and was deleted, `false` otherwise
   */
  delete = async (key: string): Promise<boolean> => this.cache.delete(key);

  /**
   * Check if a key exists and is not expired, without changing its recency.
   */
  has = async (key: string): Promise<boolean> => {
    const entry = this.cache.get(key);
    return entry !== undefined && (entry.expiresAt === null || Date.now() < entry.expiresAt);
  };

  /**
   * Remove all entries from the cache.
   */
  clear = async (): Promise<void> => {
    this.cache.clear();
  };

  /**
   * Get current cache size (number of entries).
   */
  size = (): number => this.cache.size;
}
