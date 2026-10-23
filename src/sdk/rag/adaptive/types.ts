/**
 * Adaptive RAG Types
 *
 * Core interfaces for query classification and adaptive retrieval.
 * The adaptive layer classifies queries and adjusts the RAG pipeline
 * to optimize for cost and quality based on query complexity.
 *
 * Query Types:
 * - SIMPLE: Greetings, small talk - skip retrieval
 * - FACTUAL: Standard questions - normal pipeline
 * - COMPLEX: Multi-part, analytical - full pipeline + enhancement
 * - CONVERSATIONAL: Follow-ups - use conversation context
 */

import type { RAGSearchOptions, RAGResult, RAGEngine } from '../engine/types.js';
import type { EnhancementStrategy } from '../query-enhancement/types.js';

// ============================================================================
// Query Classification Types
// ============================================================================

/**
 * Query type classification categories.
 *
 * Each type determines how the RAG pipeline should be configured:
 * - SIMPLE: Skip retrieval entirely (greetings, thanks, etc.)
 * - FACTUAL: Standard pipeline (what, who, when, where questions)
 * - COMPLEX: Full pipeline with query enhancement (compare, analyze)
 * - CONVERSATIONAL: Use conversation history for context resolution
 */
export type QueryType = 'simple' | 'factual' | 'complex' | 'conversational';

/**
 * Features extracted from a query for classification.
 *
 * These signals are computed without any LLM calls using
 * heuristic rules (regex, word lists, patterns).
 */
export interface QueryFeatures {
  /** Number of words in the query */
  wordCount: number;

  /** Number of characters in the query */
  charCount: number;

  /** Whether the query contains question words (what, who, etc.) */
  hasQuestionWords: boolean;

  /** The detected question words, if any */
  questionWords: string[];

  /** Whether the query is a greeting pattern */
  isGreeting: boolean;

  /** Whether the query contains pronouns (it, that, this) */
  hasPronouns: boolean;

  /** The pronouns found, if any */
  pronouns: string[];

  /** Whether the query contains analytical/complex keywords */
  hasComplexKeywords: boolean;

  /** Complex keywords found (compare, analyze, explain why) */
  complexKeywords: string[];

  /** Whether the query contains follow-up patterns */
  hasFollowUpPattern: boolean;

  /** Whether the query ends with a question mark */
  endsWithQuestion: boolean;

  /** Number of distinct entity-like tokens (capitalized words) */
  potentialEntityCount: number;
}

/**
 * Result of query classification.
 *
 * Contains the determined type, confidence score, and the
 * raw features used to make the decision.
 */
export interface ClassificationResult {
  /** The classified query type */
  type: QueryType;

  /**
   * Confidence score for this classification (0-1).
   *
   * Higher values indicate stronger signal for this type.
   * Low confidence may indicate ambiguous queries.
   */
  confidence: number;

  /** Raw features extracted from the query */
  features: QueryFeatures;

  /**
   * Recommended pipeline configuration based on classification.
   * These are suggestions that can be overridden by the caller.
   */
  recommendation: PipelineRecommendation;
}

/**
 * Recommended pipeline configuration based on query type.
 */
export interface PipelineRecommendation {
  /** Whether to skip retrieval entirely */
  skipRetrieval: boolean;

  /** Whether to enable query enhancement */
  enableEnhancement: boolean;

  /** Suggested enhancement strategy (if enhancement enabled) */
  suggestedStrategy?: EnhancementStrategy;

  /** Whether to enable reranking */
  enableReranking: boolean;

  /** Suggested topK based on query complexity */
  suggestedTopK: number;

  /**
   * Whether conversation history is needed to resolve the query.
   * For CONVERSATIONAL queries, the caller should resolve
   * pronouns/references before RAG retrieval.
   */
  needsConversationContext: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Thresholds for classifying queries into each type.
 *
 * These control how aggressively queries are classified.
 * Higher thresholds = fewer queries match that type.
 */
export interface ClassificationThresholds {
  /**
   * Maximum word count for SIMPLE queries.
   * Default: 4 (e.g., "hello", "thanks", "hi there")
   */
  simpleMaxWords: number;

  /**
   * Minimum word count for COMPLEX queries.
   * Default: 15
   */
  complexMinWords: number;

  /**
   * Minimum complex keywords for COMPLEX classification.
   * Default: 1
   */
  complexKeywordThreshold: number;

  /**
   * Minimum pronouns for CONVERSATIONAL classification.
   * Default: 1 (at least one pronoun like "it", "that")
   */
  conversationalPronounThreshold: number;
}

/**
 * Configuration for QueryClassifier.
 */
export interface QueryClassifierConfig {
  /**
   * Custom classification thresholds.
   * If not provided, sensible defaults are used.
   */
  thresholds?: Partial<ClassificationThresholds>;

  /**
   * Additional greeting patterns to recognize.
   * These are added to the default list.
   */
  additionalGreetings?: string[];

  /**
   * Additional complex keywords to recognize.
   * These are added to the default list.
   */
  additionalComplexKeywords?: string[];

  /**
   * Custom name for this classifier instance.
   */
  name?: string;
}

/**
 * Configuration for AdaptiveRAG wrapper.
 */
export interface AdaptiveRAGConfig {
  /**
   * The underlying RAG engine to wrap.
   */
  engine: RAGEngine;

  /**
   * Custom classifier configuration.
   * If not provided, default classifier is used.
   */
  classifierConfig?: QueryClassifierConfig;

  /**
   * Whether to include classification info in result metadata.
   * Default: true
   */
  includeClassificationInMetadata?: boolean;

  /**
   * Custom name for this adaptive engine instance.
   */
  name?: string;

  /**
   * Default options when skipRetrieval is true.
   * Controls what's returned for SIMPLE queries.
   */
  skipRetrievalDefaults?: SkipRetrievalOptions;
}

/**
 * Options for handling queries that skip retrieval.
 */
export interface SkipRetrievalOptions {
  /**
   * Content to return when retrieval is skipped.
   * Default: '' (empty string)
   */
  content?: string;

  /**
   * Message explaining why retrieval was skipped.
   * Default: 'Query classified as simple - no retrieval needed'
   */
  skipReason?: string;
}

// ============================================================================
// Search Options & Result Extensions
// ============================================================================

/**
 * Extended search options for AdaptiveRAG.
 */
export interface AdaptiveSearchOptions extends RAGSearchOptions {
  /**
   * Override the automatic classification.
   * If provided, this type is used instead of classifying the query.
   */
  overrideType?: QueryType;

  /**
   * Force retrieval even if classification suggests skipping.
   * Default: false
   */
  forceRetrieval?: boolean;

  /**
   * Conversation history for resolving CONVERSATIONAL queries.
   * Required for pronouns like "it", "that" to be resolved.
   */
  conversationHistory?: ConversationMessage[];
}

/**
 * A message in the conversation history.
 */
export interface ConversationMessage {
  /** Role: 'user' or 'assistant' */
  role: 'user' | 'assistant';
  /** Message content */
  content: string;
}

/**
 * Extended result from AdaptiveRAG.
 */
export interface AdaptiveRAGResult extends RAGResult {
  /**
   * Classification information for this query.
   * Present when includeClassificationInMetadata is true.
   */
  classification?: ClassificationResult;

  /**
   * Whether retrieval was skipped for this query.
   */
  skippedRetrieval: boolean;

  /**
   * Reason retrieval was skipped (if applicable).
   */
  skipReason?: string;
}

// ============================================================================
// Query Classifier Interface
// ============================================================================

/**
 * Interface for query classifiers.
 *
 * Query classifiers analyze incoming queries and determine
 * their type using heuristic rules. No LLM calls are made.
 *
 * @example
 * ```typescript
 * const classifier = new QueryClassifier();
 *
 * const result = classifier.classify('Hello there!');
 * // result.type: 'simple'
 * // result.confidence: 0.95
 * // result.recommendation.skipRetrieval: true
 *
 * const result2 = classifier.classify('Compare React and Vue for large apps');
 * // result2.type: 'complex'
 * // result2.recommendation.enableEnhancement: true
 * ```
 */
export interface IQueryClassifier {
  /** Human-readable name of this classifier */
  readonly name: string;

  /**
   * Classify a query into a type.
   *
   * @param query - The user's query string
   * @returns Classification result with type, confidence, and recommendations
   */
  classify(query: string): ClassificationResult;

  /**
   * Extract features from a query without classifying.
   * Useful for debugging or custom classification logic.
   *
   * @param query - The user's query string
   * @returns Extracted features
   */
  extractFeatures(query: string): QueryFeatures;
}

// ============================================================================
// Adaptive RAG Interface
// ============================================================================

/**
 * Interface for adaptive RAG engines.
 *
 * Wraps a standard RAGEngine and classifies queries to
 * optimize the pipeline configuration automatically.
 *
 * @example
 * ```typescript
 * const adaptiveRag = new AdaptiveRAG({
 *   engine: ragEngine,
 * });
 *
 * // Greetings skip retrieval
 * const r1 = await adaptiveRag.search('Hello!');
 * // r1.skippedRetrieval: true
 *
 * // Complex queries get full pipeline
 * const r2 = await adaptiveRag.search('Compare these authentication methods');
 * // r2.classification.type: 'complex'
 * // (full pipeline with enhancement)
 * ```
 */
export interface IAdaptiveRAG {
  /** Human-readable name of this adaptive engine */
  readonly name: string;

  /** The underlying RAG engine */
  readonly engine: RAGEngine;

  /** The query classifier used */
  readonly classifier: IQueryClassifier;

  /**
   * Search with adaptive query classification.
   *
   * Classifies the query, then configures and executes
   * the RAG pipeline accordingly.
   *
   * @param query - The search query
   * @param options - Adaptive search options
   * @returns Extended RAG result with classification info
   */
  search(query: string, options?: AdaptiveSearchOptions): Promise<AdaptiveRAGResult>;

  /**
   * Classify a query without executing search.
   * Useful for previewing classification before deciding to search.
   *
   * @param query - The query to classify
   * @returns Classification result
   */
  classifyOnly(query: string): ClassificationResult;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for adaptive RAG failures.
 */
export type AdaptiveRAGErrorCode =
  | 'CLASSIFICATION_ERROR'
  | 'UNDERLYING_ENGINE_ERROR'
  | 'INVALID_QUERY'
  | 'CONFIG_ERROR';

/**
 * Details about an adaptive RAG error.
 */
export interface AdaptiveRAGErrorDetails {
  /** Machine-readable error code */
  code: AdaptiveRAGErrorCode;
  /** Name of the component that failed */
  componentName: string;
  /** Query type at time of failure (if classified) */
  queryType?: QueryType;
  /** Underlying cause, if any */
  cause?: Error;
}
