/**
 * Embedding Cache
 *
 * Caching layer for embedding providers to avoid redundant computations.
 * Includes LRU in-memory cache and interface for custom implementations.
 *
 * Note: For new code, consider using the generic CacheProvider<number[]> from
 * the cache module instead. This file maintains backward compatibility with
 * the original EmbeddingCache interface.
 */

import type { EmbeddingProvider, EmbeddingResult } from './types.js';
import { BaseEmbeddingProvider } from './base-provider.js';
import { LRUCacheProvider, type CacheProvider } from '../cache/index.js';

// ============================================================================
// Cache Interface
// ============================================================================

/**
 * Interface for embedding caches.
 *
 * @deprecated For new code, prefer using `CacheProvider<number[]>` from the
 * cache module. This interface is maintained for backward compatibility.
 *
 * @example
 * ```typescript
 * // New approach (recommended):
 * import { LRUCacheProvider, type CacheProvider } from '@contextaisdk/rag';
 * const cache: CacheProvider<number[]> = new LRUCacheProvider({ maxSize: 1000 });
 *
 * // Legacy approach (still supported):
 * const legacyCache: EmbeddingCache = new LRUEmbeddingCache({ maxSize: 1000 });
 * ```
 */
export interface EmbeddingCache {
  /**
   * Get cached embedding for a text.
   * @param key - Cache key (usually hash of text)
   * @returns Cached embedding or null if not found
   */
  get(key: string): Promise<number[] | null>;

  /**
   * Store embedding in cache.
   * @param key - Cache key
   * @param embedding - Embedding vector to cache
   */
  set(key: string, embedding: number[]): Promise<void>;

  /**
   * Clear all cached embeddings.
   */
  clear(): Promise<void>;

  /**
   * Get current cache size (optional).
   */
  size?(): number;
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Configuration for LRU embedding cache.
 */
export interface LRUEmbeddingCacheConfig {
  /** Maximum number of embeddings to cache (default: 10000) */
  maxSize?: number;
}

/**
 * In-memory LRU (Least Recently Used) cache for embeddings.
 *
 * This class wraps the generic `LRUCacheProvider<number[]>` and adapts it to
 * the legacy `EmbeddingCache` interface for backward compatibility.
 *
 * @deprecated For new code, use `LRUCacheProvider<number[]>` directly from
 * the cache module. This class is maintained for backward compatibility.
 *
 * @example
 * ```typescript
 * // Legacy usage (still works):
 * const cache = new LRUEmbeddingCache({ maxSize: 1000 });
 * await cache.get('hello'); // returns null on miss
 *
 * // New approach (recommended):
 * import { LRUCacheProvider } from '@contextaisdk/rag';
 * const cache = new LRUCacheProvider<number[]>({ maxSize: 1000 });
 * await cache.get('hello'); // returns undefined on miss
 * ```
 */
export class LRUEmbeddingCache implements EmbeddingCache {
  /** Internal generic cache provider */
  private readonly provider: LRUCacheProvider<number[]>;

  constructor(config: LRUEmbeddingCacheConfig = {}) {
    this.provider = new LRUCacheProvider<number[]>({
      maxSize: config.maxSize,
    });
  }

  /**
   * Get cached embedding, moving it to front (most recently used).
   *
   * @returns Cached embedding or `null` if not found (legacy behavior)
   */
  get = async (key: string): Promise<number[] | null> => {
    const result = await this.provider.get(key);
    // Convert undefined -> null for backward compatibility
    return result ?? null;
  };

  /**
   * Store embedding, evicting least recently used if at capacity.
   */
  set = async (key: string, embedding: number[]): Promise<void> => {
    await this.provider.set(key, embedding);
  };

  /**
   * Clear all cached embeddings.
   */
  clear = async (): Promise<void> => {
    await this.provider.clear();
  };

  /**
   * Get current cache size.
   */
  size = (): number => {
    return this.provider.size();
  };

  /**
   * Access the underlying generic cache provider.
   *
   * Useful for accessing additional features like stats or TTL that aren't
   * part of the legacy EmbeddingCache interface.
   */
  getProvider = (): CacheProvider<number[]> => {
    return this.provider;
  };
}

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate a cache key from text.
 *
 * Uses a simple hash function for fast key generation.
 * For production with high collision sensitivity, consider using SHA-256.
 */
export function generateCacheKey(text: string): string {
  // Simple djb2 hash - fast and good distribution
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  // Convert to unsigned 32-bit integer, then to hex string
  return (hash >>> 0).toString(16);
}

// ============================================================================
// Cached Embedding Provider
// ============================================================================

/**
 * Configuration for cached embedding provider.
 */
export interface CachedEmbeddingProviderConfig {
  /** The underlying embedding provider */
  provider: EmbeddingProvider;
  /** Cache implementation (defaults to LRUEmbeddingCache) */
  cache?: EmbeddingCache;
  /** Maximum cache size if using default LRU cache */
  maxCacheSize?: number;
}

/**
 * Wrapper that adds caching to any embedding provider.
 *
 * Uses the Decorator Pattern to transparently cache embeddings.
 *
 * @example
 * ```typescript
 * const baseProvider = new OllamaEmbeddingProvider();
 * const cachedProvider = new CachedEmbeddingProvider({
 *   provider: baseProvider,
 *   maxCacheSize: 5000,
 * });
 *
 * // First call: generates embedding, stores in cache
 * await cachedProvider.embed('Hello'); // ~100ms
 *
 * // Second call: returns cached embedding
 * await cachedProvider.embed('Hello'); // ~0ms
 * ```
 */
export class CachedEmbeddingProvider extends BaseEmbeddingProvider {
  readonly name: string;

  /** The underlying provider */
  private readonly provider: EmbeddingProvider;

  /** The cache implementation */
  private readonly cache: EmbeddingCache;

  /** Cache statistics */
  private hits = 0;
  private misses = 0;

  constructor(config: CachedEmbeddingProviderConfig) {
    super({
      model: `cached:${config.provider.name}`,
      dimensions: config.provider.dimensions,
      batchSize: config.provider.maxBatchSize,
      normalize: false, // Provider already normalizes
    });

    this.name = `Cached${config.provider.name}`;
    this.provider = config.provider;
    this.cache =
      config.cache ?? new LRUEmbeddingCache({ maxSize: config.maxCacheSize });
  }

  /**
   * Check if the underlying provider is available.
   */
  isAvailable = async (): Promise<boolean> => {
    return this.provider.isAvailable();
  };

  /**
   * Generate embedding with caching.
   */
  protected _embed = async (text: string): Promise<EmbeddingResult> => {
    const cacheKey = generateCacheKey(text);

    // Check cache
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      this.hits++;
      return {
        embedding: cached,
        tokenCount: Math.ceil(text.length / 4),
        model: this.model,
      };
    }

    // Cache miss - generate embedding
    this.misses++;
    const result = await this.provider.embed(text);

    // Store in cache
    await this.cache.set(cacheKey, result.embedding);

    return result;
  };

  /**
   * Generate embeddings for batch with caching.
   *
   * Checks cache for each text, only generates missing ones.
   */
  protected override _embedBatch = async (
    texts: string[]
  ): Promise<EmbeddingResult[]> => {
    const results: (EmbeddingResult | null)[] = new Array(texts.length).fill(
      null
    );
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      const cacheKey = generateCacheKey(text);
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        this.hits++;
        results[i] = {
          embedding: cached,
          tokenCount: Math.ceil(text.length / 4),
          model: this.model,
        };
      } else {
        this.misses++;
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      const generated = await this.provider.embedBatch(uncachedTexts);

      // Store in cache and fill results
      for (let i = 0; i < generated.length; i++) {
        const result = generated[i]!;
        const text = uncachedTexts[i]!;
        const originalIndex = uncachedIndices[i]!;

        await this.cache.set(generateCacheKey(text), result.embedding);
        results[originalIndex] = result;
      }
    }

    return results as EmbeddingResult[];
  };

  /**
   * Get cache statistics.
   */
  getStats = (): { hits: number; misses: number; hitRate: number } => {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  };

  /**
   * Clear the cache.
   */
  clearCache = async (): Promise<void> => {
    await this.cache.clear();
  };

  /**
   * Reset statistics.
   */
  resetStats = (): void => {
    this.hits = 0;
    this.misses = 0;
  };
}
