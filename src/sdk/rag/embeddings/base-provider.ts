/**
 * Base Embedding Provider
 *
 * Abstract class providing common functionality for all embedding providers.
 */

import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingResult,
} from './types.js';
import { EmbeddingError } from './errors.js';
import { normalizeL2 } from './utils.js';

/** Default maximum batch size */
const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * Abstract base class for embedding providers.
 *
 * Provides:
 * - Input validation (empty text, batch size)
 * - Auto-batching for large requests
 * - Optional L2 normalization
 * - Consistent error handling
 *
 * Subclasses must implement:
 * - `_embed()` - Provider-specific single text embedding
 * - `_embedBatch()` - Provider-specific batch embedding (optional)
 * - `isAvailable()` - Provider availability check
 *
 * @example
 * ```typescript
 * class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
 *   constructor(apiKey: string) {
 *     super({
 *       model: 'text-embedding-3-small',
 *       dimensions: 1536,
 *       batchSize: 2048
 *     });
 *     this.apiKey = apiKey;
 *   }
 *
 *   protected async _embed(text: string): Promise<EmbeddingResult> {
 *     // Call OpenAI API
 *   }
 *
 *   async isAvailable(): Promise<boolean> {
 *     return !!this.apiKey;
 *   }
 * }
 * ```
 */
export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  /** Human-readable name of this provider */
  abstract readonly name: string;

  /** Model identifier */
  protected readonly model: string;

  /** Output embedding dimensions */
  readonly dimensions: number;

  /** Maximum texts per batch request */
  readonly maxBatchSize: number;

  /** Whether to normalize embeddings to unit length */
  protected readonly shouldNormalize: boolean;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.dimensions = config.dimensions ?? 0;
    this.maxBatchSize = config.batchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.shouldNormalize = config.normalize ?? true;
  }

  /**
   * Generate an embedding for a single text.
   *
   * Validates input, calls provider, and optionally normalizes.
   */
  embed = async (text: string): Promise<EmbeddingResult> => {
    // Validate input
    if (!text || text.trim().length === 0) {
      throw EmbeddingError.emptyInput(this.name, this.model);
    }

    // Call provider-specific implementation
    const result = await this._embed(text);

    // Optionally normalize
    if (this.shouldNormalize) {
      return {
        ...result,
        embedding: normalizeL2(result.embedding),
      };
    }

    return result;
  };

  /**
   * Generate embeddings for multiple texts.
   *
   * Automatically handles batching if texts exceed maxBatchSize.
   */
  embedBatch = async (texts: string[]): Promise<EmbeddingResult[]> => {
    // Validate input
    if (texts.length === 0) {
      return [];
    }

    // Validate each text
    for (const text of texts) {
      if (!text || text.trim().length === 0) {
        throw EmbeddingError.emptyInput(this.name, this.model);
      }
    }

    // If within batch size, process directly
    if (texts.length <= this.maxBatchSize) {
      return this._processBatch(texts);
    }

    // Otherwise, split into batches
    const results: EmbeddingResult[] = [];
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchResults = await this._processBatch(batch);
      results.push(...batchResults);
    }

    return results;
  };

  /**
   * Process a batch of texts (within maxBatchSize).
   */
  private _processBatch = async (
    texts: string[]
  ): Promise<EmbeddingResult[]> => {
    // Use provider's batch implementation if available
    const results = await this._embedBatch(texts);

    // Optionally normalize all results
    if (this.shouldNormalize) {
      return results.map((result) => ({
        ...result,
        embedding: normalizeL2(result.embedding),
      }));
    }

    return results;
  };

  /**
   * Check if the provider is available and ready.
   *
   * Subclasses must implement this to check API keys, connectivity, etc.
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Generate embedding for a single text (provider-specific).
   *
   * Subclasses must implement this with their API logic.
   * The base class handles validation and normalization.
   *
   * @param text - Text to embed (already validated as non-empty)
   * @returns Raw embedding result (normalization applied by base class)
   */
  protected abstract _embed(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for a batch of texts (provider-specific).
   *
   * Default implementation calls _embed for each text sequentially.
   * Subclasses should override for providers with native batch APIs.
   *
   * @param texts - Texts to embed (already validated, within maxBatchSize)
   * @returns Raw embedding results (normalization applied by base class)
   */
  protected _embedBatch = async (
    texts: string[]
  ): Promise<EmbeddingResult[]> => {
    // Default: sequential embedding
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this._embed(text));
    }
    return results;
  };
}
