/**
 * No-Op Cache Provider (Null Object Pattern)
 *
 * A cache implementation that doesn't actually cache anything.
 * Useful for testing, benchmarking, or disabling caching at runtime.
 */

import type { CacheProvider, CacheStats } from './types.js';

// ============================================================================
// No Cache Provider
// ============================================================================

/**
 * A cache provider that performs no caching (Null Object Pattern).
 *
 * All operations succeed but have no effect:
 * - `get()` always returns `undefined`
 * - `set()` does nothing
 * - `has()` always returns `false`
 * - `delete()` always returns `false`
 *
 * Use cases:
 * - Unit testing without caching side effects
 * - Benchmarking to compare cached vs uncached performance
 * - Runtime cache disable flag (`cache: enabled ? new LRUCacheProvider() : new NoCacheProvider()`)
 * - Development mode to ensure fresh data on every request
 *
 * @typeParam T - The type of values (unused but required for type compatibility)
 *
 * @example
 * ```typescript
 * // Disable caching based on environment
 * const cache: CacheProvider<EmbeddingResult> = process.env.DISABLE_CACHE
 *   ? new NoCacheProvider()
 *   : new LRUCacheProvider({ maxSize: 1000 });
 *
 * // Use identically - no conditional logic needed
 * await cache.set('key', value);
 * const result = await cache.get('key'); // Always undefined with NoCacheProvider
 * ```
 */
export class NoCacheProvider<T = unknown> implements CacheProvider<T> {
  // Track "miss" count for stats consistency
  private accessCount = 0;

  /**
   * Always returns `undefined` (cache miss).
   */
  get = async (_key: string): Promise<T | undefined> => {
    this.accessCount++;
    return undefined;
  };

  /**
   * Does nothing (no-op).
   */
  set = async (_key: string, _value: T, _ttl?: number): Promise<void> => {
    // Intentionally empty - this is the Null Object Pattern
  };

  /**
   * Always returns `false` (nothing to delete).
   */
  delete = async (_key: string): Promise<boolean> => {
    return false;
  };

  /**
   * Always returns `false` (cache is always empty).
   */
  has = async (_key: string): Promise<boolean> => {
    return false;
  };

  /**
   * Resets access count (no-op for actual clearing).
   */
  clear = async (): Promise<void> => {
    this.accessCount = 0;
  };

  /**
   * Always returns 0 (cache is always empty).
   */
  size = (): number => {
    return 0;
  };

  /**
   * Get cache statistics.
   *
   * - hits: always 0 (nothing is ever cached)
   * - misses: count of `get()` calls
   * - size: always 0
   * - hitRate: always 0
   */
  getStats = (): CacheStats => {
    return {
      hits: 0,
      misses: this.accessCount,
      size: 0,
      hitRate: 0,
    };
  };

  /**
   * Reset statistics.
   */
  resetStats = (): void => {
    this.accessCount = 0;
  };
}
