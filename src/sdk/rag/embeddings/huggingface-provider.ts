/**
 * HuggingFace Embedding Provider
 *
 * Uses Transformers.js for browser and Node.js embedding generation.
 * Default model: Xenova/bge-large-en-v1.5 (1024 dimensions)
 *
 * Runs on @huggingface/transformers (the successor to @xenova/transformers).
 */

import type { EmbeddingResult } from './types.js';
import { BaseEmbeddingProvider } from './base-provider.js';
import { EmbeddingError } from './errors.js';
import { loadTransformers, withModelDownloadLock } from '../transformers.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for HuggingFace embedding provider.
 */
export interface HuggingFaceEmbeddingConfig {
  /** Model identifier (e.g., "Xenova/bge-large-en-v1.5") */
  model?: string;
  /** Output embedding dimensions (auto-detected from model if not specified) */
  dimensions?: number;
  /** Maximum texts per batch request */
  batchSize?: number;
  /** Whether to normalize embeddings to unit length (default: true) */
  normalize?: boolean;
  /** Device to run inference on: 'cpu' | 'gpu' | 'auto' */
  device?: 'cpu' | 'gpu' | 'auto';
  /** Progress callback for model download */
  onProgress?: (progress: { status: string; progress?: number }) => void;
}

/**
 * Internal type for the Transformers.js pipeline function.
 * Using unknown to avoid requiring the optional dependency's types.
 */
type TransformersPipeline = (
  text: string | string[],
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: Float32Array; tolist: () => number[] | number[][] }>;

// ============================================================================
// Constants
// ============================================================================

/** Default HuggingFace model for embeddings */
const DEFAULT_MODEL = 'Xenova/bge-large-en-v1.5';

/** Default dimensions for BGE-large model */
const DEFAULT_DIMENSIONS = 1024;

/** Maximum batch size for inference */
const DEFAULT_BATCH_SIZE = 32;

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * HuggingFace embedding provider using Transformers.js.
 *
 * Provides local embedding generation without API calls.
 * Supports both browser and Node.js environments.
 *
 * @example
 * ```typescript
 * const provider = new HuggingFaceEmbeddingProvider({
 *   model: 'Xenova/bge-large-en-v1.5',
 * });
 *
 * if (await provider.isAvailable()) {
 *   const result = await provider.embed('Hello, world!');
 *   console.log(result.embedding.length); // 1024
 * }
 * ```
 */
export class HuggingFaceEmbeddingProvider extends BaseEmbeddingProvider {
  readonly name = 'HuggingFaceEmbeddingProvider';

  /** Device configuration for inference */
  private readonly device: 'cpu' | 'gpu' | 'auto';

  /** Progress callback for model download */
  private readonly onProgress?: (progress: {
    status: string;
    progress?: number;
  }) => void;

  /** Cached pipeline instance (lazy loaded) */
  private pipeline: TransformersPipeline | null = null;

  /** Loading promise to prevent duplicate loads */
  private loadingPromise: Promise<TransformersPipeline> | null = null;

  constructor(config: HuggingFaceEmbeddingConfig = {}) {
    super({
      model: config.model ?? DEFAULT_MODEL,
      dimensions: config.dimensions ?? DEFAULT_DIMENSIONS,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      normalize: config.normalize ?? true,
    });
    this.device = config.device ?? 'auto';
    this.onProgress = config.onProgress;
  }

  /**
   * Check if the provider is available.
   *
   * Verifies that @huggingface/transformers can be loaded.
   */
  isAvailable = async (): Promise<boolean> => {
    try {
      // Check if transformers.js is available (optional peer dependency)
      await loadTransformers();
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Load the embedding pipeline lazily.
   */
  private loadPipeline = async (): Promise<TransformersPipeline> => {
    // Return existing pipeline if already loaded
    if (this.pipeline) {
      return this.pipeline;
    }

    // Wait for existing load if in progress
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    // Start loading
    this.loadingPromise = this.doLoadPipeline();

    try {
      this.pipeline = await this.loadingPromise;
      return this.pipeline;
    } finally {
      this.loadingPromise = null;
    }
  };

  /**
   * Actually load the pipeline from Transformers.js.
   */
  private doLoadPipeline = async (): Promise<TransformersPipeline> => {
    try {
      const { pipeline } = await loadTransformers();

      // q8: the quantized weights @xenova/transformers loaded by default, so
      // embeddings stay comparable with indexes built before the upgrade.
      const pipe = await withModelDownloadLock(this.model, () =>
        pipeline('feature-extraction', this.model, {
          dtype: 'q8',
          ...(this.device === 'cpu' ? { device: 'cpu' as const } : {}),
          progress_callback: this.onProgress,
        })
      );

      return pipe as TransformersPipeline;
    } catch (error) {
      throw EmbeddingError.providerUnavailable(
        this.name,
        this.model,
        'Failed to load model with @huggingface/transformers.',
        error instanceof Error ? error : undefined
      );
    }
  };

  /**
   * Generate embedding for a single text.
   */
  protected _embed = async (text: string): Promise<EmbeddingResult> => {
    const pipe = await this.loadPipeline();

    try {
      // Run inference
      const output = await pipe(text, {
        pooling: 'mean',
        normalize: false, // Base class handles normalization
      });

      // Convert to regular array
      const embedding = Array.from(output.data);

      return {
        embedding,
        tokenCount: this.estimateTokenCount(text),
        model: this.model,
      };
    } catch (error) {
      throw EmbeddingError.invalidResponse(
        this.name,
        this.model,
        'Failed to generate embedding',
        error instanceof Error ? error : undefined
      );
    }
  };

  /**
   * Generate embeddings for a batch of texts.
   *
   * Override default sequential behavior for efficiency.
   */
  protected override _embedBatch = async (
    texts: string[]
  ): Promise<EmbeddingResult[]> => {
    const pipe = await this.loadPipeline();

    try {
      // Run batch inference
      const output = await pipe(texts, {
        pooling: 'mean',
        normalize: false,
      });

      // Convert to results - tolist() returns number[][] for batch
      const embeddings = output.tolist() as number[][];

      return texts.map((text, i) => {
        const embedding = embeddings[i];
        if (!embedding) {
          throw EmbeddingError.invalidResponse(
            this.name,
            this.model,
            `Missing embedding at index ${i}`
          );
        }
        return {
          embedding,
          tokenCount: this.estimateTokenCount(text),
          model: this.model,
        };
      });
    } catch (error) {
      // Fall back to sequential if batch fails
      const results: EmbeddingResult[] = [];
      for (const text of texts) {
        results.push(await this._embed(text));
      }
      return results;
    }
  };

  /**
   * Estimate token count based on character length.
   *
   * Uses a rough heuristic of ~4 characters per token for English text.
   */
  private estimateTokenCount = (text: string): number => {
    return Math.ceil(text.length / 4);
  };

  /**
   * Check if the model is loaded.
   * Useful for checking warmup status.
   */
  isLoaded = (): boolean => {
    return this.pipeline !== null;
  };

  /**
   * Pre-load the embedding model.
   *
   * Call this during application startup to avoid first-request latency.
   * The model is loaded lazily by default, so the first embed() call
   * can take several seconds while the model downloads and initializes.
   *
   * @example
   * ```typescript
   * const provider = new HuggingFaceEmbeddingProvider();
   * await provider.warmup(); // Pre-load during startup
   * // Now embed() calls will be fast
   * ```
   */
  warmup = async (): Promise<void> => {
    await this.loadPipeline();
  };
}
