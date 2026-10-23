/**
 * BGE Cross-Encoder Reranker
 *
 * Uses BAAI BGE reranker models via Transformers.js to score
 * query-document pairs with a cross-encoder architecture.
 *
 * Cross-encoders process query and document together, allowing
 * the model to capture fine-grained interactions that bi-encoders miss.
 *
 * @example
 * ```typescript
 * const reranker = new BGEReranker({
 *   modelName: 'Xenova/bge-reranker-base',
 * });
 *
 * const reranked = await reranker.rerank(query, retrievalResults, { topK: 5 });
 * ```
 */

import type { RetrievalResult } from '../retrieval/types.js';
import type { BGERerankerConfig, RerankerOptions } from './types.js';
import { BaseReranker, type InternalRerankerResult } from './base-reranker.js';
import { RerankerError } from './errors.js';
import { loadTransformers } from '../transformers.js';

// Transformers.js types (dynamically imported)
type Pipeline = (
  inputs: Array<{ text: string; text_pair: string }>,
  options?: { padding?: boolean; truncation?: boolean }
) => Promise<Array<{ score: number }>>;

/**
 * Default BGE reranker model.
 * 'Xenova/bge-reranker-base' is a good balance of quality and speed (~110MB).
 */
const DEFAULT_MODEL = 'Xenova/bge-reranker-base';

/**
 * Default maximum sequence length.
 * BGE models typically support up to 512 tokens.
 */
const DEFAULT_MAX_LENGTH = 512;

/**
 * BGE Cross-Encoder Reranker.
 *
 * Reranks retrieval results using a BAAI BGE cross-encoder model.
 * The model scores each query-document pair, providing more accurate
 * relevance scores than embedding similarity.
 *
 * Performance characteristics:
 * - Latency: ~50-100ms per document (CPU), ~10-20ms per document (GPU)
 * - Memory: ~110MB (base) or ~330MB (large)
 * - Accuracy: Significantly better than bi-encoder similarity
 *
 * @example
 * ```typescript
 * // Create reranker (loads model lazily on first use)
 * const reranker = new BGEReranker({
 *   modelName: 'Xenova/bge-reranker-base',
 * });
 *
 * // Rerank search results
 * const results = await retriever.retrieve('How to reset password?');
 * const reranked = await reranker.rerank('How to reset password?', results, {
 *   topK: 5,
 * });
 *
 * // Access score breakdown
 * reranked.forEach(r => {
 *   console.log(`${r.chunk.content.slice(0, 50)}...`);
 *   console.log(`  Original rank: ${r.originalRank} -> New rank: ${r.newRank}`);
 *   console.log(`  Scores: original=${r.scores.originalScore.toFixed(3)}, reranker=${r.scores.rerankerScore.toFixed(3)}`);
 * });
 * ```
 */
export class BGEReranker extends BaseReranker {
  readonly name: string;
  private readonly modelName: string;
  private readonly maxLength: number;
  private readonly device: 'cpu' | 'gpu' | 'auto';

  /** Pipeline instance (lazily loaded) */
  private pipeline: Pipeline | null = null;
  /** Promise for ongoing model loading (prevents duplicate loads) */
  private loadingPromise: Promise<Pipeline> | null = null;

  /**
   * Override: BGE outputs are already meaningful scores, we apply
   * sigmoid normalization instead of min-max to preserve semantics.
   */
  protected override readonly shouldNormalize = false;

  constructor(config: BGERerankerConfig = {}) {
    super();
    this.name = config.name ?? 'BGEReranker';
    this.modelName = config.modelName ?? DEFAULT_MODEL;
    this.maxLength = config.maxLength ?? DEFAULT_MAX_LENGTH;
    this.device = config.device ?? 'auto';
  }

  /**
   * Load the Transformers.js pipeline.
   *
   * Uses lazy loading to avoid importing the large transformers library
   * until actually needed. Also prevents duplicate loading via promise caching.
   */
  private async loadPipeline(): Promise<Pipeline> {
    // Return cached pipeline if available
    if (this.pipeline) {
      return this.pipeline;
    }

    // Return existing loading promise if in progress
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
  }

  /**
   * Actually load the pipeline from Transformers.js.
   */
  private async doLoadPipeline(): Promise<Pipeline> {
    try {
      const { pipeline } = await loadTransformers();

      // Create the text-classification pipeline for reranking
      // BGE rerankers use the 'text-classification' task
      const pipe = await pipeline('text-classification', this.modelName, {
        ...(this.device === 'auto' ? {} : { device: this.device }),
        // Quantized models for faster inference
        dtype: 'q8',
      }) as unknown as (
        text: string,
        options?: { text_pair?: string; padding?: boolean; truncation?: boolean; max_length?: number }
      ) => Promise<Array<{ label: string; score: number }>>;

      // Wrap the pipeline to match our expected signature
      return async (inputs, options) => {
        const results: Array<{ score: number }> = [];

        for (const input of inputs) {
          // Cross-encoders expect [CLS] query [SEP] document [SEP] format
          // The pipeline handles this automatically with text/text_pair
          const output = await pipe(input.text, {
            text_pair: input.text_pair,
            padding: options?.padding ?? true,
            truncation: options?.truncation ?? true,
            max_length: this.maxLength,
          });

          // Output is [{label: 'LABEL_0', score: X}] - we want the score
          // For rerankers, higher score = more relevant
          const score = Array.isArray(output) ? output[0]?.score ?? 0 : 0;
          results.push({ score });
        }

        return results;
      };
    } catch (error) {
      throw RerankerError.modelLoadFailed(
        this.name,
        `Failed to load model '${this.modelName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Rerank results using the BGE cross-encoder.
   */
  protected _rerank = async (
    query: string,
    results: RetrievalResult[],
    _options?: RerankerOptions
  ): Promise<InternalRerankerResult[]> => {
    // Load model (lazy, cached)
    const pipe = await this.loadPipeline();

    // Prepare inputs for batch processing
    const inputs = results.map((r) => ({
      text: query,
      text_pair: r.chunk.content,
    }));

    try {
      // Score all query-document pairs
      const scores = await pipe(inputs, {
        padding: true,
        truncation: true,
      });

      // Map scores back to results
      return results.map((r, i) => {
        // Raw score from cross-encoder (can be any range)
        const rawScore = scores[i]?.score ?? 0;

        // Apply sigmoid to normalize to 0-1 range
        // This preserves the relative ordering while giving interpretable scores
        const normalizedScore = this.sigmoid(rawScore);

        return {
          id: r.id,
          score: normalizedScore,
          original: r,
          scoreComponents: {
            // Store raw score for debugging
            relevanceScore: rawScore,
          },
        };
      });
    } catch (error) {
      throw RerankerError.rerankingFailed(
        this.name,
        `Cross-encoder scoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  };

  /**
   * Sigmoid function to normalize scores to 0-1 range.
   *
   * Cross-encoder outputs can be in any range (often -10 to +10).
   * Sigmoid maps this to (0, 1) while preserving ordering.
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Check if the model is loaded.
   * Useful for pre-warming the model before first use.
   */
  isLoaded(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Pre-load the model.
   * Call this during application startup to avoid first-request latency.
   */
  warmup = async (): Promise<void> => {
    await this.loadPipeline();
  };
}
