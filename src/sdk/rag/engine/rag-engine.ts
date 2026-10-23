/**
 * RAG Engine Implementation
 *
 * High-level orchestrator that coordinates the full RAG pipeline:
 * Query Enhancement → Retrieval → Reranking → Verification → Context Assembly
 *
 * This is the primary integration point for agents and tools.
 */

import type { QueryEnhancer, EnhancementResult } from '../query-enhancement/types.js';
import type { Retriever, RetrievalResult } from '../retrieval/types.js';
import type { Reranker, RerankerResult } from '../reranker/types.js';
import type { Verifier, VerifiedRetrievalResult } from '../verifier/types.js';
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
    enhance: options.enhance,
    rerank: options.rerank,
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
 *   // Optional components
 *   enhancer: new QueryRewriter({ llmProvider }),
 *   reranker: new MMRReranker({ defaultLambda: 0.7 }),
 * });
 *
 * const result = await engine.search('How do I reset my password?');
 * console.log(result.content); // Formatted context for LLM
 * ```
 */
export class RAGEngineImpl implements RAGEngine {
  readonly name: string;

  private readonly enhancer?: QueryEnhancer;
  private readonly retriever: Retriever;
  private readonly reranker?: Reranker;
  private readonly verifier?: Verifier;
  private readonly assembler: ContextAssembler;
  private readonly cache?: CacheProvider<RAGResult>;
  private readonly defaults: Required<NonNullable<RAGEngineConfig['defaults']>> & { verify: boolean };

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
    this.enhancer = config.enhancer;
    this.retriever = config.retriever;
    this.reranker = config.reranker;
    this.verifier = config.verifier;
    this.assembler = config.assembler;
    this.cache = config.cache;

    // Merge defaults
    this.defaults = {
      topK: config.defaults?.topK ?? 10,
      minScore: config.defaults?.minScore ?? 0,
      ordering: config.defaults?.ordering ?? 'relevance',
      enhance: config.defaults?.enhance ?? true,
      rerank: config.defaults?.rerank ?? true,
      verify: config.defaults?.verify ?? true,
      useCache: config.defaults?.useCache ?? true,
      cacheTtl: config.defaults?.cacheTtl ?? 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Search the knowledge base for relevant information.
   *
   * Pipeline: enhance → retrieve → rerank → verify → assemble
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
      enhance: options.enhance ?? (this.enhancer ? this.defaults.enhance : false),
      rerank: options.rerank ?? (this.reranker ? this.defaults.rerank : false),
      verify: options.verify ?? (this.verifier ? this.defaults.verify : false),
      ordering: options.ordering ?? this.defaults.ordering,
      maxTokens: options.maxTokens,
      retrieval: options.retrieval,
      verificationOptions: options.verificationOptions,
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

    // Track queries for metadata
    let effectiveQuery = trimmedQuery;
    let allQueries: string[] | undefined;
    let enhancement: EnhancementResult | undefined;

    // =========================================================================
    // Stage 1: Query Enhancement (Optional)
    // =========================================================================
    if (effectiveOptions.enhance && this.enhancer) {
      this.checkAborted(effectiveOptions.signal, 'enhancement');

      const enhanceStart = Date.now();
      try {
        enhancement = await this.enhancer.enhance(trimmedQuery);
        timings.enhancementMs = Date.now() - enhanceStart;

        // Use enhanced queries if available
        if (enhancement.enhanced.length > 0) {
          effectiveQuery = enhancement.enhanced[0]!;
          allQueries = [trimmedQuery, ...enhancement.enhanced];
        }
      } catch (error) {
        throw RAGEngineError.enhancementFailed(
          this.name,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    // =========================================================================
    // Stage 2: Retrieval
    // =========================================================================
    this.checkAborted(effectiveOptions.signal, 'retrieval');

    const retrieveStart = Date.now();
    let retrievalResults: RetrievalResult[];

    try {
      // If we have multiple queries (from multi-query enhancement), retrieve for each
      // and deduplicate by ID, keeping highest score
      if (allQueries && allQueries.length > 1) {
        const allResults = await Promise.all(
          allQueries.map((q) =>
            this.retriever.retrieve(q, {
              topK: effectiveOptions.topK,
              minScore: effectiveOptions.minScore,
              ...effectiveOptions.retrieval,
            })
          )
        );

        // Merge and deduplicate
        const resultMap = new Map<string, RetrievalResult>();
        for (const results of allResults) {
          for (const result of results) {
            const existing = resultMap.get(result.id);
            if (!existing || result.score > existing.score) {
              resultMap.set(result.id, result);
            }
          }
        }

        // Sort by score and take topK
        retrievalResults = Array.from(resultMap.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, effectiveOptions.topK);
      } else {
        retrievalResults = await this.retriever.retrieve(effectiveQuery, {
          topK: effectiveOptions.topK,
          minScore: effectiveOptions.minScore,
          ...effectiveOptions.retrieval,
        });
      }

      timings.retrievalMs = Date.now() - retrieveStart;
    } catch (error) {
      throw RAGEngineError.retrievalFailed(
        this.name,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }

    // =========================================================================
    // Stage 3: Reranking (Optional)
    // =========================================================================
    let rerankerResults: RerankerResult[] | undefined;

    if (effectiveOptions.rerank && this.reranker && retrievalResults.length > 0) {
      this.checkAborted(effectiveOptions.signal, 'reranking');

      const rerankStart = Date.now();
      try {
        rerankerResults = await this.reranker.rerank(
          effectiveQuery,
          retrievalResults,
          { topK: effectiveOptions.topK }
        );
        timings.rerankingMs = Date.now() - rerankStart;
      } catch (error) {
        throw RAGEngineError.rerankingFailed(
          this.name,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    // =========================================================================
    // Stage 4: Verification (Optional)
    // =========================================================================
    let verificationResults: VerifiedRetrievalResult[] | undefined;

    if (effectiveOptions.verify && this.verifier && retrievalResults.length > 0) {
      this.checkAborted(effectiveOptions.signal, 'verification');

      const verifyStart = Date.now();
      try {
        // Prepare results for verification
        // Transfer confidence scores from retrieval results
        const resultsToVerify = rerankerResults
          ? rerankerResults.map((r) => {
              // Find original retrieval result to get confidence
              const original = retrievalResults.find((rr) => rr.id === r.id);
              return {
                id: r.id,
                chunk: r.chunk,
                score: r.score,
                confidence: original?.confidence,
              };
            })
          : retrievalResults;

        verificationResults = await this.verifier.verify(
          effectiveQuery,
          resultsToVerify,
          effectiveOptions.verificationOptions
        );

        timings.verificationMs = Date.now() - verifyStart;
      } catch (error) {
        throw RAGEngineError.verificationFailed(
          this.name,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        );
      }
    }

    // =========================================================================
    // Stage 5: Context Assembly
    // =========================================================================
    this.checkAborted(effectiveOptions.signal, 'assembly');

    const assemblyStart = Date.now();
    let assembly: AssembledContext;

    try {
      // Determine which results to assemble
      // Priority: verified > reranked > retrieval
      let resultsToAssemble: RerankerResult[];

      if (verificationResults) {
        // Filter to only verified results, then convert to RerankerResult format
        const verified = verificationResults.filter(
          (r) => r.verification?.verified
        );
        resultsToAssemble = verified.map((r, idx) => ({
          id: r.id,
          chunk: r.chunk,
          score: r.score,
          originalRank: idx + 1,
          newRank: idx + 1,
          scores: {
            originalScore: r.score,
            rerankerScore: r.verification?.verificationScore ?? r.score,
          },
        }));
      } else if (rerankerResults) {
        resultsToAssemble = rerankerResults;
      } else {
        resultsToAssemble = retrievalResults.map((r, idx) => ({
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
      }

      assembly = await this.assembler.assemble(resultsToAssemble, {
        topK: effectiveOptions.topK,
        ordering: effectiveOptions.ordering,
        maxTokens: effectiveOptions.maxTokens,
      });

      timings.assemblyMs = Date.now() - assemblyStart;
    } catch (error) {
      throw RAGEngineError.assemblyFailed(
        this.name,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }

    // =========================================================================
    // Build Result
    // =========================================================================
    timings.totalMs = Date.now() - startTime;

    const metadata: RAGSearchMetadata = {
      effectiveQuery,
      allQueries,
      enhancement,
      retrievedCount: retrievalResults.length,
      rerankedCount: rerankerResults?.length,
      verifiedCount: verificationResults
        ? verificationResults.filter((r) => r.verification?.verified).length
        : undefined,
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
      rerankerResults,
      verificationResults,
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
   * Pre-load optional components (reranker, enhancer, etc.).
   *
   * Call this during application startup to avoid first-request latency.
   * Components that use ML models need to download and initialize their
   * models on first use, which can take several seconds.
   *
   * This method calls warmup() on any components that support it:
   * - BGEReranker.warmup() - Loads the reranking model
   * - HuggingFaceEmbeddingProvider.warmup() - Loads the embedding model
   *
   * @example
   * ```typescript
   * const engine = new RAGEngineImpl({ ... });
   * await engine.warmUp(); // Pre-load during startup
   * // Now search() calls will be fast
   * ```
   */
  warmUp = async (): Promise<void> => {
    const warmupPromises: Promise<void>[] = [];

    // Warm up reranker if it has a warmup method
    if (this.reranker && 'warmup' in this.reranker) {
      const rerankerWarmup = (this.reranker as { warmup?: () => Promise<void> })
        .warmup;
      if (typeof rerankerWarmup === 'function') {
        warmupPromises.push(rerankerWarmup());
      }
    }

    // Note: enhancer and retriever typically don't need warmup
    // since they don't load ML models. If they do in the future,
    // similar warmup calls can be added here.

    await Promise.all(warmupPromises);
  };

  /**
   * Check if operation has been aborted.
   */
  private checkAborted(
    signal: AbortSignal | undefined,
    stage: 'enhancement' | 'retrieval' | 'reranking' | 'verification' | 'assembly'
  ): void {
    if (signal?.aborted) {
      throw RAGEngineError.aborted(this.name, stage);
    }
  }
}
