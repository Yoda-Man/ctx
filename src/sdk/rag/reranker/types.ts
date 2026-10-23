/**
 * Reranker Types
 *
 * Core interfaces for post-retrieval re-ranking.
 * Rerankers improve relevance by scoring query-document pairs
 * more accurately than initial retrieval methods.
 */

import type { Chunk } from '../vector-store/types.js';
import type { RetrievalResult } from '../retrieval/types.js';

// ============================================================================
// Reranker Result Types
// ============================================================================

/**
 * Score breakdown showing how the final score was computed.
 *
 * Different rerankers populate different fields:
 * - BGE: originalScore + rerankerScore
 * - MMR: originalScore + relevanceScore + diversityPenalty
 * - LLM: originalScore + rerankerScore
 */
export interface RerankerScores {
  /** Original score from the retriever (before reranking) */
  originalScore: number;
  /** Score assigned by the reranker */
  rerankerScore: number;
  /** For MMR: relevance component (similarity to query) */
  relevanceScore?: number;
  /** For MMR: diversity penalty (similarity to already-selected docs) */
  diversityPenalty?: number;
}

/**
 * A single reranked result with score transparency.
 *
 * Extends RetrievalResult with reranking-specific information
 * to show how the result's rank changed and why.
 */
export interface RerankerResult {
  /** Unique identifier of the chunk */
  id: string;
  /** The reranked chunk content */
  chunk: Chunk;
  /** The final relevance score after reranking (0-1, higher = more relevant) */
  score: number;
  /** Original rank before reranking (1-indexed) */
  originalRank: number;
  /** New rank after reranking (1-indexed) */
  newRank: number;
  /** Score breakdown for transparency */
  scores: RerankerScores;
}

// ============================================================================
// Reranker Options
// ============================================================================

/**
 * Options for reranking operations.
 */
export interface RerankerOptions {
  /** Maximum number of results to return (default: same as input length) */
  topK?: number;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Include score breakdown in results (default: true) */
  includeScoreBreakdown?: boolean;
}

// ============================================================================
// Reranker Interface
// ============================================================================

/**
 * Interface for all rerankers.
 *
 * Rerankers take retrieval results and reorder them based on
 * more accurate (but slower) scoring methods.
 *
 * @example
 * ```typescript
 * const reranker: Reranker = new BGEReranker({
 *   modelName: 'BAAI/bge-reranker-base',
 * });
 *
 * const reranked = await reranker.rerank(
 *   'How do I reset my password?',
 *   retrievalResults,
 *   { topK: 5 }
 * );
 * ```
 */
export interface Reranker {
  /** Human-readable name of this reranker */
  readonly name: string;

  /**
   * Rerank retrieval results based on query relevance.
   *
   * @param query - The search query (natural language)
   * @param results - Results from initial retrieval
   * @param options - Reranking options
   * @returns Array of results sorted by reranked relevance (descending)
   */
  rerank(
    query: string,
    results: RetrievalResult[],
    options?: RerankerOptions
  ): Promise<RerankerResult[]>;
}

// ============================================================================
// BGE Reranker Configuration
// ============================================================================

/**
 * Configuration for BGE cross-encoder reranker.
 *
 * BGE (BAAI General Embedding) rerankers use cross-encoder architecture
 * to score query-document pairs jointly, providing more accurate relevance
 * scores than bi-encoder embeddings.
 */
export interface BGERerankerConfig {
  /** Name for this reranker instance (default: 'BGEReranker') */
  name?: string;

  /**
   * Model identifier for Transformers.js.
   * Default: 'Xenova/bge-reranker-base'
   *
   * Available models (smallest to largest):
   * - 'Xenova/bge-reranker-base' (~110MB, good balance)
   * - 'Xenova/bge-reranker-large' (~330MB, best quality)
   */
  modelName?: string;

  /**
   * Whether to normalize scores to 0-1 range.
   * Cross-encoder outputs raw logits which can be negative.
   * Default: true
   */
  normalizeScores?: boolean;

  /**
   * Maximum sequence length for the model.
   * Longer sequences are truncated.
   * Default: 512
   */
  maxLength?: number;

  /**
   * Device to run inference on.
   * - 'cpu' - Always use CPU (slower but universal)
   * - 'gpu' - Attempt GPU acceleration (may not be available)
   * - 'auto' - Automatically detect best option (default)
   */
  device?: 'cpu' | 'gpu' | 'auto';
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for reranking failures.
 */
export type RerankerErrorCode =
  | 'MODEL_LOAD_FAILED'
  | 'RERANKING_FAILED'
  | 'INVALID_INPUT'
  | 'CONFIG_ERROR'
  | 'LLM_ERROR'
  | 'EMBEDDING_REQUIRED';

/**
 * Details about a reranker error.
 */
export interface RerankerErrorDetails {
  /** Machine-readable error code */
  code: RerankerErrorCode;
  /** Name of the reranker that failed */
  rerankerName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
