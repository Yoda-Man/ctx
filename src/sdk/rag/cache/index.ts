/**
 * Cache Module
 *
 * Generic caching infrastructure for the RAG pipeline.
 * Provides a unified interface for caching embeddings, query results, and other data.
 *
 * @example
 * ```typescript
 * import { LRUCacheProvider, NoCacheProvider, type CacheProvider } from '@contextaisdk/rag';
 *
 * // Type-safe embedding cache
 * const embeddingCache: CacheProvider<number[]> = new LRUCacheProvider({
 *   maxSize: 10000,
 * });
 *
 * // Query result cache with TTL
 * const queryCache: CacheProvider<SearchResult[]> = new LRUCacheProvider({
 *   maxSize: 1000,
 *   defaultTtl: 5 * 60 * 1000, // 5 minutes
 * });
 *
 * // Disable caching for testing
 * const noCache: CacheProvider<string> = new NoCacheProvider();
 * ```
 */

// Types (tree-shakeable)
export type {
  CacheProvider,
  CacheStats,
  LRUCacheConfig,
  SizeEstimator,
} from './types.js';

// Implementations
export { LRUCacheProvider } from './lru-cache.js';
export { NoCacheProvider } from './no-cache.js';
