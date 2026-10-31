/**
 * RAG Engine Implementation
 *
 * High-level orchestrator that coordinates the RAG pipeline ctx runs:
 * Retrieval (hybrid search, already reranked) → Context Assembly, with a cache.
 *
 * This is the primary integration point for agents and tools.
 */

import type { Retriever, RetrievalResult } from '../retrieval/types.js';
import type { RerankerResult } from '../reranker/types.js';
import type { ContextAssembler, AssembledContext } from '../assembly/types.js';
import type { CacheProvider } from '../cache/types.js';
import type {
  RAGEngine,
  RAGEngineConfig,
  RAGSearchOptions,
  RAGResult,
  RAGSearchMetadata,
  RAGTimings,
} from './types.js';
import { RAGEngineError } from './errors.js';
import { errorMessage } from '../../../utils/error.js';

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate a cache key from query and options.
 * Uses a simple hash for fast key generation.
 */
function generateCacheKey(query: string, options: RAGSearchOptions): string {
  // Create a deterministic string from query + relevant options
  const optionStr = JSON.stringify({
    topK: options.topK,
    minScore: options.minScore,
    ordering: options.ordering,
    maxTokens: options.maxTokens,
    retrieval: options.retrieval,
  });

  const combined = `${query}|${optionStr}`;

  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 33) ^ combined.charCodeAt(i);
  }
  return `rag_${(hash >>> 0).toString(16)}`;
}

// ============================================================================
// RAG Engine Implementation
// ============================================================================

/**
 * High-level RAG orchestrator implementation.
 *
 * Coordinates the full RAG pipeline and provides a simple search() API.
 *
 * @example
 * ```typescript
 * const engine = new RAGEngineImpl({
 *   retriever: new HybridRetriever({
 *     vectorStore,
 *     embeddingProvider,
 *     documents,
 *   }),
 *   assembler: new XMLAssembler({
 *     ordering: 'sandwich',
 *     tokenBudget: { maxTokens: 4000 },
 *   }),
 * });
 *
 * const result = await engine.search('How do I reset my password?');
 * console.log(result.content); // Formatted context for LLM
 * ```
 */
export class RAGEngineImpl implements RAGEngine {
  readonly name: string;

  private readonly retriever: Retriever;
  private readonly assembler: ContextAssembler;
  private readonly cache?: CacheProvider<RAGResult>;
  private readonly defaults: Required<NonNullable<RAGEngineConfig['defaults']>>;

  constructor(config: RAGEngineConfig) {
    // Validate required components
    if (!config.retriever) {
      throw RAGEngineError.configError(
        config.name ?? 'RAGEngine',
        'retriever is required'
      );
    }
    if (!config.assembler) {
      throw RAGEngineError.configError(
        config.name ?? 'RAGEngine',
        'assembler is required'
      );
    }

    this.name = config.name ?? 'RAGEngine';
    this.retriever = config.retriever;
    this.assembler = config.assembler;
    this.cache = config.cache;

    // Merge defaults
    this.defaults = {
      topK: config.defaults?.topK ?? 10,
      minScore: config.defaults?.minScore ?? 0,
      ordering: config.defaults?.ordering ?? 'relevance',
      useCache: config.defaults?.useCache ?? true,
      cacheTtl: config.defaults?.cacheTtl ?? 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Search the knowledge base for relevant information.
   *
   * Pipeline: retrieve → assemble
   */
  search = async (
    query: string,
    options: RAGSearchOptions = {}
  ): Promise<RAGResult> => {
    const startTime = Date.now();

    // Validate query
    if (!query || typeof query !== 'string') {
      throw RAGEngineError.invalidQuery(this.name, 'query must be a non-empty string');
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw RAGEngineError.invalidQuery(this.name, 'query must not be empty');
    }

    // Merge options with defaults
    const effectiveOptions = {
      topK: options.topK ?? this.defaults.topK,
      minScore: options.minScore ?? this.defaults.minScore,
      ordering: options.ordering ?? this.defaults.ordering,
      maxTokens: options.maxTokens,
      retrieval: options.retrieval,
      useCache: options.useCache ?? (this.cache ? this.defaults.useCache : false),
      cacheTtl: options.cacheTtl ?? this.defaults.cacheTtl,
      signal: options.signal,
    };

    // Check cache first
    if (effectiveOptions.useCache && this.cache) {
      const cacheKey = generateCacheKey(trimmedQuery, effectiveOptions);
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          // Return cached result with fromCache flag
          return {
            ...cached,
            metadata: {
              ...cached.metadata,
              fromCache: true,
            },
          };
        }
      } catch (error) {
        // Cache errors are non-fatal, log and continue
        console.warn(`[${this.name}] Cache get error:`, error);
      }
    }

    // Initialize timing
    const timings: RAGTimings = {
      retrievalMs: 0,
      assemblyMs: 0,
      totalMs: 0,
    };

    // =========================================================================
    // Stage 1: Retrieval
    // =========================================================================
    this.checkAborted(effectiveOptions.signal, 'retrieval');

    const retrieveStart = Date.now();
    let retrievalResults: RetrievalResult[];

    try {
      retrievalResults = await this.retriever.retrieve(trimmedQuery, {
        topK: effectiveOptions.topK,
        minScore: effectiveOptions.minScore,
        ...effectiveOptions.retrieval,
      });
      timings.retrievalMs = Date.now() - retrieveStart;
    } catch (error) {
      throw RAGEngineError.retrievalFailed(
        this.name,
        errorMessage(error),
        error instanceof Error ? error : undefined
      );
    }

    // =========================================================================
    // Stage 2: Context Assembly
    // =========================================================================
    this.checkAborted(effectiveOptions.signal, 'assembly');

    const assemblyStart = Date.now();
    let assembly: AssembledContext;

    try {
      const resultsToAssemble: RerankerResult[] = retrievalResults.map((r, idx) => ({
        id: r.id,
        chunk: r.chunk,
        score: r.score,
        originalRank: idx + 1,
        newRank: idx + 1,
        scores: {
          originalScore: r.score,
          rerankerScore: r.score,
        },
      }));

      assembly = await this.assembler.assemble(resultsToAssemble, {
        topK: effectiveOptions.topK,
        ordering: effectiveOptions.ordering,
        maxTokens: effectiveOptions.maxTokens,
      });

      timings.assemblyMs = Date.now() - assemblyStart;
    } catch (error) {
      throw RAGEngineError.assemblyFailed(
        this.name,
        errorMessage(error),
        error instanceof Error ? error : undefined
      );
    }

    // =========================================================================
    // Build Result
    // =========================================================================
    timings.totalMs = Date.now() - startTime;

    const metadata: RAGSearchMetadata = {
      effectiveQuery: trimmedQuery,
      retrievedCount: retrievalResults.length,
      assembledCount: assembly.chunkCount,
      deduplicatedCount: assembly.deduplicatedCount,
      droppedCount: assembly.droppedCount,
      fromCache: false,
      timings,
    };

    const result: RAGResult = {
      content: assembly.content,
      estimatedTokens: assembly.estimatedTokens,
      sources: assembly.sources,
      assembly,
      retrievalResults,
      metadata,
    };

    // Store in cache
    if (effectiveOptions.useCache && this.cache) {
      const cacheKey = generateCacheKey(trimmedQuery, effectiveOptions);
      try {
        await this.cache.set(cacheKey, result, effectiveOptions.cacheTtl);
      } catch (error) {
        // Cache errors are non-fatal
        console.warn(`[${this.name}] Cache set error:`, error);
      }
    }

    return result;
  };

  /**
   * Clear the result cache.
   */
  clearCache = async (): Promise<void> => {
    if (this.cache) {
      await this.cache.clear();
    }
  };

  /**
   * Check if operation has been aborted.
   */
  private checkAborted(
    signal: AbortSignal | undefined,
    stage: 'retrieval' | 'assembly'
  ): void {
    if (signal?.aborted) {
      throw RAGEngineError.aborted(this.name, stage);
    }
  }
}
