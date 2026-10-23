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
interface EnhancementMetadata {
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
interface EnhanceOptions {
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
