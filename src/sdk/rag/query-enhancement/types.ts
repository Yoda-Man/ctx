/**
 * Query Enhancement Types
 *
 * Core interfaces for pre-retrieval query optimization.
 * Query enhancers transform user queries to improve retrieval quality.
 *
 * Strategies:
 * - Rewriting: Clarify ambiguous queries via LLM
 * - HyDE: Generate hypothetical answers, embed them for retrieval
 * - Multi-query: Expand single query into multiple perspectives
 */

import type { LLMProvider } from '../../core/index.js';
import type { EmbeddingProvider } from '../embeddings/types.js';

// ============================================================================
// Enhancement Strategy Types
// ============================================================================

/**
 * Type of query enhancement strategy used.
 *
 * Each strategy has different trade-offs:
 * - 'rewrite': 1 LLM call, returns single clarified query
 * - 'hyde': 1+ LLM calls + embedding, returns queries based on hypothetical docs
 * - 'multi-query': 1 LLM call, returns multiple query variants
 * - 'passthrough': No transformation (for testing/fallback)
 */
export type EnhancementStrategy =
  | 'rewrite'
  | 'hyde'
  | 'multi-query'
  | 'passthrough';

// ============================================================================
// Result Types
// ============================================================================

/**
 * Metadata about the enhancement operation.
 * Provides transparency into what was done and at what cost.
 */
export interface EnhancementMetadata {
  /** Total tokens used by LLM calls (if available) */
  tokensUsed?: number;
  /** Time spent on LLM calls in milliseconds */
  llmLatencyMs?: number;
  /** For HyDE: the generated hypothetical document(s) */
  hypotheticalDocs?: string[];
  /** For multi-query: reasoning behind each variant */
  queryReasonings?: string[];
  /** Whether enhancement was skipped (e.g., query too short) */
  skipped?: boolean;
  /** Reason for skipping enhancement */
  skipReason?: string;
}

/**
 * Result of a query enhancement operation.
 *
 * Always returns the original query plus enhanced variants.
 * The enhanced array may be empty if enhancement was skipped.
 */
export interface EnhancementResult {
  /** The original input query (unchanged) */
  original: string;
  /**
   * Enhanced query variants.
   *
   * For 'rewrite': Single clarified query
   * For 'hyde': Queries derived from hypothetical documents
   * For 'multi-query': Multiple perspective queries
   *
   * May be empty if enhancement was skipped.
   */
  enhanced: string[];
  /** Strategy that produced this result */
  strategy: EnhancementStrategy;
  /** Metadata about the operation */
  metadata: EnhancementMetadata;
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for enhancement operations.
 */
export interface EnhanceOptions {
  /**
   * Minimum query length to attempt enhancement.
   * Very short queries (e.g., single words) may not benefit.
   * Default: 3 characters
   */
  minQueryLength?: number;
  /**
   * Maximum number of enhanced variants to generate.
   * Default varies by strategy.
   */
  maxVariants?: number;
  /**
   * Temperature for LLM generation.
   * Higher = more creative, lower = more focused.
   * Default varies by strategy (0.3-0.7 typical).
   */
  temperature?: number;
  /**
   * Whether to include the original query in results.
   * When true, original is prepended to enhanced array.
   * Default: false (original only in `original` field)
   */
  includeOriginal?: boolean;
}

// ============================================================================
// Query Enhancer Interface
// ============================================================================

/**
 * Interface for all query enhancers.
 *
 * Query enhancers transform user queries before retrieval
 * to improve search quality. All enhancers follow the same
 * interface but implement different strategies.
 *
 * @example
 * ```typescript
 * const rewriter = new QueryRewriter({
 *   llmProvider: new OpenAIProvider({ model: 'gpt-4o-mini' }),
 * });
 *
 * const result = await rewriter.enhance('hw do i reset pasword?');
 * // result.enhanced: ['How do I reset my password?']
 * ```
 */
export interface QueryEnhancer {
  /** Human-readable name of this enhancer */
  readonly name: string;
  /** Strategy type this enhancer implements */
  readonly strategy: EnhancementStrategy;

  /**
   * Enhance a query for better retrieval.
   *
   * @param query - The user's original query
   * @param options - Enhancement options
   * @returns Enhanced queries with metadata
   */
  enhance(query: string, options?: EnhanceOptions): Promise<EnhancementResult>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Base configuration shared by all enhancers.
 */
export interface BaseEnhancerConfig {
  /** Custom name for this enhancer instance */
  name?: string;
}

/**
 * Configuration for QueryRewriter.
 *
 * The rewriter clarifies ambiguous or poorly-formed queries
 * by rephrasing them for clarity while preserving intent.
 */
export interface QueryRewriterConfig extends BaseEnhancerConfig {
  /** LLM provider for query rewriting */
  llmProvider: LLMProvider;
  /**
   * Prompt template for rewriting.
   * Placeholder: {query}
   *
   * Default: Instructs LLM to clarify and rephrase.
   */
  promptTemplate?: string;
  /**
   * System prompt for the LLM.
   * Default: Query clarification instructions.
   */
  systemPrompt?: string;
  /**
   * Temperature for generation.
   * Lower = more conservative rewrites.
   * Default: 0.3
   */
  temperature?: number;
}

/**
 * Configuration for HyDEEnhancer.
 *
 * HyDE (Hypothetical Document Embeddings) generates a hypothetical
 * answer to the query, then uses its embedding for retrieval.
 * This can find documents similar to what the answer *should* look like.
 *
 * Reference: Gao et al., "Precise Zero-Shot Dense Retrieval without Relevance Labels"
 */
export interface HyDEConfig extends BaseEnhancerConfig {
  /** LLM provider for generating hypothetical documents */
  llmProvider: LLMProvider;
  /** Embedding provider for embedding hypothetical documents */
  embeddingProvider: EmbeddingProvider;
  /**
   * Number of hypothetical documents to generate.
   * More = better coverage but higher cost.
   * Default: 1
   */
  numHypothetical?: number;
  /**
   * Prompt template for hypothetical document generation.
   * Placeholder: {query}
   *
   * Default: Instructs LLM to write a passage that answers the query.
   */
  promptTemplate?: string;
  /**
   * System prompt for the LLM.
   * Default: Document generation instructions.
   */
  systemPrompt?: string;
  /**
   * Temperature for generation.
   * Higher = more diverse hypothetical docs.
   * Default: 0.7
   */
  temperature?: number;
  /**
   * Maximum tokens for hypothetical document.
   * Default: 256
   */
  maxTokens?: number;
}

/**
 * Configuration for MultiQueryExpander.
 *
 * Generates multiple query variants from different perspectives
 * to retrieve a broader set of relevant documents.
 */
export interface MultiQueryConfig extends BaseEnhancerConfig {
  /** LLM provider for query expansion */
  llmProvider: LLMProvider;
  /**
   * Number of query variants to generate.
   * Default: 3
   */
  numVariants?: number;
  /**
   * Prompt template for expansion.
   * Placeholders: {query}, {numVariants}
   *
   * Default: Instructs LLM to generate diverse reformulations.
   */
  promptTemplate?: string;
  /**
   * System prompt for the LLM.
   * Default: Query expansion instructions.
   */
  systemPrompt?: string;
  /**
   * Temperature for generation.
   * Higher = more diverse variants.
   * Default: 0.5
   */
  temperature?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for query enhancement failures.
 */
export type QueryEnhancementErrorCode =
  | 'LLM_ERROR'
  | 'EMBEDDING_ERROR'
  | 'INVALID_INPUT'
  | 'CONFIG_ERROR'
  | 'PARSE_ERROR';

/**
 * Details about a query enhancement error.
 */
export interface QueryEnhancementErrorDetails {
  /** Machine-readable error code */
  code: QueryEnhancementErrorCode;
  /** Name of the enhancer that failed */
  enhancerName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
