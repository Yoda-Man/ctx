/**
 * RAG Engine Types
 *
 * Core interfaces for the high-level RAG orchestrator.
 * The RAGEngine coordinates the RAG pipeline ctx runs:
 * Retrieval → Context Assembly (with an optional result cache)
 *
 * This is the integration layer that brings all components together
 * and exposes a simple search() API for agents and tools.
 */

import type { Retriever, RetrievalResult, RetrievalOptions } from '../retrieval/types.js';
import type {
  ContextAssembler,
  AssembledContext,
  OrderingStrategy,
} from '../assembly/types.js';
import type { CacheProvider } from '../cache/types.js';

// ============================================================================
// RAG Engine Configuration
// ============================================================================

/**
 * Configuration for RAGEngine.
 *
 * Retriever and assembler are required; the cache is optional.
 *
 * @example
 * ```typescript
 * const engine = new RAGEngine({
 *   retriever: new HybridRetriever({ ... }),
 *   assembler: new XMLAssembler({ ... }),
 * });
 * ```
 */
export interface RAGEngineConfig {
  /**
   * Required retriever for finding relevant chunks.
   * Can be dense, sparse, or hybrid.
   */
  retriever: Retriever;

  /**
   * Required assembler for formatting context for LLM consumption.
   */
  assembler: ContextAssembler;

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
interface RAGSearchDefaults {
  /** Default topK for retrieval */
  topK?: number;
  /** Default minimum score threshold */
  minScore?: number;
  /** Default ordering strategy */
  ordering?: OrderingStrategy;
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
  /** Time spent on retrieval (ms) */
  retrievalMs: number;
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
  /** The query used for retrieval */
  effectiveQuery: string;
  /** Number of results from retrieval */
  retrievedCount: number;
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
   * Orchestrates: retrieve → assemble
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
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for RAG engine failures.
 */
export type RAGEngineErrorCode =
  | 'INVALID_QUERY'
  | 'RETRIEVAL_FAILED'
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
  stage?: 'retrieval' | 'assembly' | 'cache';
  /** Underlying cause, if any */
  cause?: Error;
}
