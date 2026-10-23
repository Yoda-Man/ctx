/**
 * Adaptive RAG
 *
 * Wraps a standard RAGEngine with query classification to
 * automatically optimize the pipeline based on query complexity.
 *
 * - SIMPLE queries (greetings) skip retrieval entirely
 * - FACTUAL queries use standard pipeline
 * - COMPLEX queries enable query enhancement + full pipeline
 * - CONVERSATIONAL queries flag that context resolution is needed
 *
 * @example
 * ```typescript
 * const adaptiveRag = new AdaptiveRAG({
 *   engine: ragEngine,
 * });
 *
 * // Greeting - skips retrieval
 * const r1 = await adaptiveRag.search('Hello!');
 * // r1.skippedRetrieval === true
 *
 * // Complex - full pipeline with enhancement
 * const r2 = await adaptiveRag.search('Compare React and Vue');
 * // Uses multi-query enhancement, higher topK
 * ```
 */

import type {
  RAGEngine,
  RAGResult,
  RAGSearchMetadata,
  RAGTimings,
} from '../engine/types.js';
import type {
  AdaptiveRAGConfig,
  AdaptiveSearchOptions,
  AdaptiveRAGResult,
  ClassificationResult,
  IAdaptiveRAG,
  IQueryClassifier,
  SkipRetrievalOptions,
} from './types.js';
import { QueryClassifier } from './query-classifier.js';
import { AdaptiveRAGError } from './errors.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SKIP_RETRIEVAL_OPTIONS: SkipRetrievalOptions = {
  content: '',
  skipReason: 'Query classified as simple - no retrieval needed',
};

// ============================================================================
// AdaptiveRAG Implementation
// ============================================================================

/**
 * Adaptive RAG engine wrapper.
 *
 * Automatically classifies queries and configures the underlying
 * RAG engine for optimal performance based on query type.
 */
export class AdaptiveRAG implements IAdaptiveRAG {
  readonly name: string;
  readonly engine: RAGEngine;
  readonly classifier: IQueryClassifier;

  private readonly includeClassificationInMetadata: boolean;
  private readonly skipRetrievalDefaults: SkipRetrievalOptions;

  constructor(config: AdaptiveRAGConfig) {
    if (!config.engine) {
      throw new AdaptiveRAGError('RAGEngine is required', {
        code: 'CONFIG_ERROR',
        componentName: 'AdaptiveRAG',
      });
    }

    this.name = config.name ?? 'AdaptiveRAG';
    this.engine = config.engine;
    this.classifier = config.classifierConfig
      ? new QueryClassifier(config.classifierConfig)
      : new QueryClassifier();
    this.includeClassificationInMetadata = config.includeClassificationInMetadata ?? true;
    this.skipRetrievalDefaults = {
      ...DEFAULT_SKIP_RETRIEVAL_OPTIONS,
      ...config.skipRetrievalDefaults,
    };
  }

  /**
   * Search with adaptive query classification.
   */
  search = async (query: string, options?: AdaptiveSearchOptions): Promise<AdaptiveRAGResult> => {
    const startTime = Date.now();

    // Validate input
    if (!query || typeof query !== 'string') {
      throw new AdaptiveRAGError('Query must be a non-empty string', {
        code: 'INVALID_QUERY',
        componentName: this.name,
      });
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new AdaptiveRAGError('Query must be a non-empty string', {
        code: 'INVALID_QUERY',
        componentName: this.name,
      });
    }

    // Classify the query (or use override)
    let classification: ClassificationResult;
    try {
      classification = options?.overrideType
        ? this.createOverrideClassification(options.overrideType, trimmedQuery)
        : this.classifier.classify(trimmedQuery);
    } catch (error) {
      throw new AdaptiveRAGError('Query classification failed', {
        code: 'CLASSIFICATION_ERROR',
        componentName: this.name,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }

    // Check if we should skip retrieval
    const shouldSkip = classification.recommendation.skipRetrieval && !options?.forceRetrieval;

    if (shouldSkip) {
      return this.createSkipRetrievalResult(classification, trimmedQuery, startTime);
    }

    // Handle CONVERSATIONAL queries - warn if no history provided
    if (
      classification.type === 'conversational' &&
      classification.recommendation.needsConversationContext &&
      (!options?.conversationHistory || options.conversationHistory.length === 0)
    ) {
      // We'll still execute the search, but the result may be suboptimal
      // The caller should ideally resolve pronouns before calling search
    }

    // Execute search with optimized options
    try {
      const searchOptions = this.buildSearchOptions(classification, options);
      const result = await this.engine.search(trimmedQuery, searchOptions);

      return this.wrapResult(result, classification, false);
    } catch (error) {
      throw new AdaptiveRAGError('Underlying RAG engine search failed', {
        code: 'UNDERLYING_ENGINE_ERROR',
        componentName: this.name,
        queryType: classification.type,
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  };

  /**
   * Classify a query without executing search.
   */
  classifyOnly = (query: string): ClassificationResult => {
    if (!query || typeof query !== 'string') {
      throw new AdaptiveRAGError('Query must be a non-empty string', {
        code: 'INVALID_QUERY',
        componentName: this.name,
      });
    }

    return this.classifier.classify(query.trim());
  };

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create a classification result when type is overridden.
   */
  private createOverrideClassification(type: string, query: string): ClassificationResult {
    // Validate the override type
    const validTypes = ['simple', 'factual', 'complex', 'conversational'];
    if (!validTypes.includes(type)) {
      throw new AdaptiveRAGError(`Invalid override type: ${type}. Must be one of: ${validTypes.join(', ')}`, {
        code: 'INVALID_QUERY',
        componentName: this.name,
      });
    }

    // Extract features but use override type
    const features = this.classifier.extractFeatures(query);

    // Generate recommendation for the override type
    const recommendation = this.getRecommendationForType(type as 'simple' | 'factual' | 'complex' | 'conversational', features);

    return {
      type: type as 'simple' | 'factual' | 'complex' | 'conversational',
      confidence: 1.0, // Override is explicit
      features,
      recommendation,
    };
  }

  /**
   * Get default recommendation for a query type.
   */
  private getRecommendationForType(
    type: 'simple' | 'factual' | 'complex' | 'conversational',
    features: ClassificationResult['features']
  ): ClassificationResult['recommendation'] {
    switch (type) {
      case 'simple':
        return {
          skipRetrieval: true,
          enableEnhancement: false,
          enableReranking: false,
          suggestedTopK: 0,
          needsConversationContext: false,
        };
      case 'factual':
        return {
          skipRetrieval: false,
          enableEnhancement: false,
          enableReranking: true,
          suggestedTopK: 5,
          needsConversationContext: false,
        };
      case 'complex':
        return {
          skipRetrieval: false,
          enableEnhancement: true,
          suggestedStrategy: features.wordCount > 20 ? 'multi-query' : 'rewrite',
          enableReranking: true,
          suggestedTopK: 10,
          needsConversationContext: false,
        };
      case 'conversational':
        return {
          skipRetrieval: false,
          enableEnhancement: false,
          enableReranking: true,
          suggestedTopK: 5,
          needsConversationContext: true,
        };
    }
  }

  /**
   * Build search options based on classification.
   */
  private buildSearchOptions(
    classification: ClassificationResult,
    userOptions?: AdaptiveSearchOptions
  ): AdaptiveSearchOptions {
    const recommendation = classification.recommendation;

    return {
      // Start with user options
      ...userOptions,

      // Apply recommendations (user options can override)
      topK: userOptions?.topK ?? recommendation.suggestedTopK,
      enhance: userOptions?.enhance ?? recommendation.enableEnhancement,
      rerank: userOptions?.rerank ?? recommendation.enableReranking,
    };
  }

  /**
   * Create result when retrieval is skipped.
   */
  private createSkipRetrievalResult(
    classification: ClassificationResult,
    query: string,
    startTime: number
  ): AdaptiveRAGResult {
    const totalMs = Date.now() - startTime;

    const timings: RAGTimings = {
      retrievalMs: 0,
      assemblyMs: 0,
      totalMs,
    };

    const metadata: RAGSearchMetadata = {
      effectiveQuery: query,
      retrievedCount: 0,
      assembledCount: 0,
      deduplicatedCount: 0,
      droppedCount: 0,
      fromCache: false,
      timings,
    };

    // Create minimal RAG result
    const baseResult: RAGResult = {
      content: this.skipRetrievalDefaults.content ?? '',
      estimatedTokens: 0,
      sources: [],
      assembly: {
        content: this.skipRetrievalDefaults.content ?? '',
        estimatedTokens: 0,
        chunkCount: 0,
        deduplicatedCount: 0,
        droppedCount: 0,
        sources: [],
        chunks: [],
      },
      retrievalResults: [],
      metadata,
    };

    return {
      ...baseResult,
      classification: this.includeClassificationInMetadata ? classification : undefined,
      skippedRetrieval: true,
      skipReason: this.skipRetrievalDefaults.skipReason,
    };
  }

  /**
   * Wrap a RAG result with adaptive metadata.
   */
  private wrapResult(
    result: RAGResult,
    classification: ClassificationResult,
    skippedRetrieval: boolean
  ): AdaptiveRAGResult {
    return {
      ...result,
      classification: this.includeClassificationInMetadata ? classification : undefined,
      skippedRetrieval,
      skipReason: skippedRetrieval ? this.skipRetrievalDefaults.skipReason : undefined,
    };
  }
}
