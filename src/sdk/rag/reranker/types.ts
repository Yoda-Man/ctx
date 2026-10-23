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

/**
 * Options specific to MMR reranking.
 */
export interface MMRRerankerOptions extends RerankerOptions {
  /**
   * Balance between relevance and diversity.
   *
   * - 0.0 = maximize diversity (ignore relevance)
   * - 0.5 = balanced (default)
   * - 1.0 = maximize relevance (ignore diversity)
   *
   * Higher values prioritize relevance, lower values prioritize diversity.
   */
  lambda?: number;
}

/**
 * Options specific to LLM reranking.
 */
export interface LLMRerankerOptions extends RerankerOptions {
  /**
   * Maximum concurrent LLM calls.
   * Higher values increase speed but may hit rate limits.
   * Default: 5
   */
  concurrency?: number;
  /**
   * Whether to use batch scoring (single prompt with all docs).
   * More efficient but may reduce accuracy for many docs.
   * Default: false (score each doc individually)
   */
  batchMode?: boolean;
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
// MMR Reranker Configuration
// ============================================================================

/**
 * Configuration for MMR (Maximal Marginal Relevance) reranker.
 *
 * MMR balances relevance and diversity to avoid returning
 * multiple documents that say the same thing.
 *
 * Formula: MMR = λ * Sim(q, d) - (1-λ) * max(Sim(d, d_selected))
 */
export interface MMRRerankerConfig {
  /** Name for this reranker instance (default: 'MMRReranker') */
  name?: string;

  /**
   * Default lambda value (can be overridden per-query).
   * Default: 0.5 (balanced)
   */
  defaultLambda?: number;

  /**
   * Similarity function for comparing embeddings.
   * Default: 'cosine'
   */
  similarityFunction?: 'cosine' | 'dotProduct' | 'euclidean';
}

// ============================================================================
// LLM Reranker Configuration
// ============================================================================

/**
 * Configuration for LLM-based reranker.
 *
 * Uses an LLM to score relevance of documents to a query.
 * Most accurate but also most expensive option.
 */
export interface LLMRerankerConfig {
  /** Name for this reranker instance (default: 'LLMReranker') */
  name?: string;

  /**
   * Prompt template for scoring.
   * Available placeholders: {query}, {document}
   *
   * Default prompt asks for 0-10 relevance score.
   */
  promptTemplate?: string;

  /**
   * System prompt for the LLM.
   * Default: instructs to act as a relevance judge.
   */
  systemPrompt?: string;

  /**
   * Temperature for LLM responses.
   * Lower = more deterministic scores.
   * Default: 0 (deterministic)
   */
  temperature?: number;

  /**
   * Default concurrency limit.
   * Default: 5
   */
  defaultConcurrency?: number;
}

// ============================================================================
// Position Bias Types
// ============================================================================

/**
 * Strategy for position bias mitigation.
 *
 * LLMs exhibit "lost in the middle" phenomenon where they pay
 * more attention to content at the beginning and end of context.
 */
export type PositionBiasStrategy =
  | 'none' // Keep original order
  | 'sandwich' // Most relevant at start and end, less relevant in middle
  | 'reverse-sandwich' // Less relevant at edges, most relevant in middle
  | 'interleave'; // Alternate high and low relevance

/**
 * Configuration for position bias mitigation.
 */
export interface PositionBiasConfig {
  /** Strategy to use (default: 'none') */
  strategy: PositionBiasStrategy;
  /**
   * For 'sandwich': how many top items to place at the start.
   * Remaining top items go at the end.
   * Default: half of topK
   */
  startCount?: number;
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
