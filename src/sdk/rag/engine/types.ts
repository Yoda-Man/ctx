/**
 * RAG Engine Types
 *
 * Core interfaces for the high-level RAG orchestrator.
 * The RAGEngine coordinates the full RAG pipeline:
 * Query Enhancement → Retrieval → Reranking → Context Assembly
 *
 * This is the integration layer that brings all components together
 * and exposes a simple search() API for agents and tools.
 */

import type { QueryEnhancer, EnhancementResult } from '../query-enhancement/types.js';
import type { Retriever, RetrievalResult, RetrievalOptions } from '../retrieval/types.js';
import type { Reranker, RerankerResult } from '../reranker/types.js';
import type {
  ContextAssembler,
  AssembledContext,
  OrderingStrategy,
} from '../assembly/types.js';
import type { CacheProvider } from '../cache/types.js';
import type { Verifier, VerifierOptions, VerifiedRetrievalResult } from '../verifier/types.js';

// ============================================================================
// RAG Engine Configuration
// ============================================================================

/**
 * Configuration for RAGEngine.
 *
 * Only retriever and assembler are required. Optional components
 * (enhancer, reranker, cache) are skipped if not provided.
 *
 * @example
 * ```typescript
 * const engine = new RAGEngine({
 *   retriever: new HybridRetriever({ ... }),
 *   assembler: new XMLAssembler({ ... }),
 *   // Optional: add components for better quality
 *   enhancer: new QueryRewriter({ ... }),
 *   reranker: new MMRReranker({ ... }),
 * });
 * ```
 */
export interface RAGEngineConfig {
  /**
   * Optional query enhancer for pre-retrieval optimization.
   * If not provided, queries are used as-is.
   */
  enhancer?: QueryEnhancer;

  /**
   * Required retriever for finding relevant chunks.
   * Can be dense, sparse, or hybrid.
   */
  retriever: Retriever;

  /**
   * Optional reranker for post-retrieval relevance optimization.
   * If not provided, retrieval results are used directly.
   */
  reranker?: Reranker;

  /**
   * Required assembler for formatting context for LLM consumption.
   */
  assembler: ContextAssembler;

  /**
   * Optional verifier for post-retrieval relevance verification.
   * Uses LLM to judge if documents are truly relevant to the query.
   * If not provided, verification is skipped.
   */
  verifier?: Verifier;

  /**
   * Optional cache for storing search results.
   * Key is the query + options hash, value is RAGResult.
   */
  cache?: CacheProvider<RAGResult>;

  /**
   * Name for this engine instance.
   * Default: 'RAGEngine'
   */
  name?: string;

  /**
   * Default options for search operations.
   * Can be overridden per-search.
   */
  defaults?: RAGSearchDefaults;
}

/**
 * Default values for search options.
 */
export interface RAGSearchDefaults {
  /** Default topK for retrieval */
  topK?: number;
  /** Default minimum score threshold */
  minScore?: number;
  /** Default ordering strategy */
  ordering?: OrderingStrategy;
  /** Default: whether to enhance queries */
  enhance?: boolean;
  /** Default: whether to rerank results */
  rerank?: boolean;
  /** Default: whether to verify results */
  verify?: boolean;
  /** Default: whether to use cache */
  useCache?: boolean;
  /** Default cache TTL in milliseconds */
  cacheTtl?: number;
}

// ============================================================================
// Search Options
// ============================================================================

/**
 * Options for a single search operation.
 *
 * All options are optional and override engine defaults.
 */
export interface RAGSearchOptions {
  /**
   * Maximum number of results to retrieve.
   * Default: 10
   */
  topK?: number;

  /**
   * Minimum relevance score threshold (0-1).
   * Results below this score are excluded.
   */
  minScore?: number;

  /**
   * Whether to enhance the query before retrieval.
   * Default: true if enhancer is configured
   */
  enhance?: boolean;

  /**
   * Whether to rerank results after retrieval.
   * Default: true if reranker is configured
   */
  rerank?: boolean;

  /**
   * Whether to verify results after reranking.
   * Default: true if verifier is configured
   */
  verify?: boolean;

  /**
   * Verification options (thresholds, concurrency, etc.)
   */
  verificationOptions?: VerifierOptions;

  /**
   * Ordering strategy for assembled context.
   * Overrides assembler config for this search.
   */
  ordering?: OrderingStrategy;

  /**
   * Maximum tokens for assembled context.
   * Overrides assembler config for this search.
   */
  maxTokens?: number;

  /**
   * Additional retrieval options (filters, alpha, etc.)
   */
  retrieval?: RetrievalOptions;

  /**
   * Whether to use cache for this search.
   * Default: true if cache is configured
   */
  useCache?: boolean;

  /**
   * Cache TTL in milliseconds for this result.
   * Only used if useCache is true.
   */
  cacheTtl?: number;

  /**
   * Abort signal for cancellation.
   */
  signal?: AbortSignal;
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Timing information for pipeline stages.
 */
export interface RAGTimings {
  /** Time spent on query enhancement (ms) */
  enhancementMs?: number;
  /** Time spent on retrieval (ms) */
  retrievalMs: number;
  /** Time spent on reranking (ms) */
  rerankingMs?: number;
  /** Time spent on verification (ms) */
  verificationMs?: number;
  /** Time spent on assembly (ms) */
  assemblyMs: number;
  /** Total pipeline time (ms) */
  totalMs: number;
}

/**
 * Detailed metadata about the search operation.
 *
 * Provides transparency into what happened during the search.
 */
export interface RAGSearchMetadata {
  /** The query used for retrieval (may differ from original if enhanced) */
  effectiveQuery: string;
  /** All queries used (if multi-query enhancement) */
  allQueries?: string[];
  /** Enhancement result details (if enhancement was performed) */
  enhancement?: EnhancementResult;
  /** Number of results from retrieval (before reranking) */
  retrievedCount: number;
  /** Number of results after reranking */
  rerankedCount?: number;
  /** Number of results after verification */
  verifiedCount?: number;
  /** Number of chunks included in assembled context */
  assembledCount: number;
  /** Number of chunks deduplicated */
  deduplicatedCount: number;
  /** Number of chunks dropped due to token budget */
  droppedCount: number;
  /** Whether result was served from cache */
  fromCache: boolean;
  /** Pipeline timing information */
  timings: RAGTimings;
}

/**
 * Result of a RAG search operation.
 *
 * Contains the assembled context ready for LLM consumption,
 * plus detailed metadata for debugging and observability.
 */
export interface RAGResult {
  /**
   * The assembled context string ready for LLM consumption.
   * Formatted according to the assembler configuration.
   */
  content: string;

  /**
   * Estimated token count for the assembled content.
   */
  estimatedTokens: number;

  /**
   * Source attributions for citation generation.
   */
  sources: AssembledContext['sources'];

  /**
   * The full assembled context object (includes chunks).
   */
  assembly: AssembledContext;

  /**
   * Retrieval results before assembly (for debugging).
   */
  retrievalResults: RetrievalResult[];

  /**
   * Reranked results (if reranking was performed).
   */
  rerankerResults?: RerankerResult[];

  /**
   * Verified results (if verification was performed).
   */
  verificationResults?: VerifiedRetrievalResult[];

  /**
   * Search metadata for debugging and observability.
   */
  metadata: RAGSearchMetadata;
}

// ============================================================================
// RAG Engine Interface
// ============================================================================

/**
 * High-level RAG orchestrator interface.
 *
 * The RAGEngine coordinates the full RAG pipeline and provides
 * a simple search() API. This is the primary interface for
 * integrating RAG into agents and tools.
 *
 * @example
 * ```typescript
 * const engine: RAGEngine = new RAGEngineImpl({
 *   retriever: new HybridRetriever({ ... }),
 *   assembler: new XMLAssembler({ ... }),
 * });
 *
 * const result = await engine.search('How do I reset my password?');
 * console.log(result.content); // Formatted context for LLM
 * console.log(result.sources); // For citations
 * ```
 */
export interface RAGEngine {
  /** Human-readable name of this engine */
  readonly name: string;

  /**
   * Search the knowledge base for relevant information.
   *
   * Orchestrates: enhance → retrieve → rerank → assemble
   *
   * @param query - The search query (natural language)
   * @param options - Search options (topK, filters, etc.)
   * @returns Assembled context with metadata
   */
  search(query: string, options?: RAGSearchOptions): Promise<RAGResult>;

  /**
   * Clear the result cache (if cache is configured).
   */
  clearCache(): Promise<void>;

  /**
   * Pre-load optional components (reranker, enhancer, etc.).
   *
   * Call this during application startup to avoid first-request latency.
   * Components that use ML models (like BGE reranker or HuggingFace embeddings)
   * need to download and initialize their models on first use, which can
   * take several seconds.
   *
   * By calling warmUp() during startup, the first search() call will be fast.
   *
   * @example
   * ```typescript
   * const engine = new RAGEngineImpl({ ... });
   * await engine.warmUp(); // Pre-load during startup
   * // Now search() calls will be fast
   * ```
   */
  warmUp(): Promise<void>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for RAG engine failures.
 */
export type RAGEngineErrorCode =
  | 'INVALID_QUERY'
  | 'ENHANCEMENT_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'RERANKING_FAILED'
  | 'VERIFICATION_FAILED'
  | 'ASSEMBLY_FAILED'
  | 'CACHE_ERROR'
  | 'CONFIG_ERROR'
  | 'ABORTED';

/**
 * Details about a RAG engine error.
 */
export interface RAGEngineErrorDetails {
  /** Machine-readable error code */
  code: RAGEngineErrorCode;
  /** Name of the engine that failed */
  engineName: string;
  /** Which pipeline stage failed */
  stage?: 'enhancement' | 'retrieval' | 'reranking' | 'verification' | 'assembly' | 'cache';
  /** Underlying cause, if any */
  cause?: Error;
}
