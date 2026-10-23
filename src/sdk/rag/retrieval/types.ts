/**
 * Retrieval Types
 *
 * Core interfaces for the hybrid retrieval system.
 * Supports dense (vector), sparse (BM25), and hybrid search.
 */

import type { Chunk, MetadataFilter } from '../vector-store/types.js';

// ============================================================================
// Retrieval Result Types
// ============================================================================

/**
 * Transparency scores showing contribution of each retrieval method.
 *
 * This allows users to understand WHY a result was ranked highly:
 * - High dense, low sparse: semantically similar but different words
 * - Low dense, high sparse: exact keyword match but different meaning
 * - Both high: strong match on both dimensions
 */
interface HybridScore {
  /** Score from dense (vector) retrieval (0-1, higher = more similar) */
  dense: number;
  /** Score from sparse (BM25) retrieval (normalized 0-1) */
  sparse: number;
  /** Final fused score after RRF combination */
  fused: number;
}

// ============================================================================
// Confidence Score Types
// ============================================================================

/**
 * Confidence score breakdown for a retrieval result.
 *
 * Provides transparency into how confident the system is that this result
 * is truly relevant to the query. Higher scores indicate stronger signals
 * from multiple retrieval methods agreeing on the result's relevance.
 *
 * @example
 * ```typescript
 * // High confidence result (ranked highly by multiple methods)
 * {
 *   overall: 0.92,
 *   signals: { vectorSimilarity: 0.95, keywordMatch: 0.88 },
 *   factors: {
 *     rankAgreement: 0.95,
 *     scoreConsistency: 0.90,
 *     signalCount: 2,
 *     multiSignalPresence: true
 *   }
 * }
 *
 * // Lower confidence (only one method found it)
 * {
 *   overall: 0.45,
 *   signals: { vectorSimilarity: 0.75 },
 *   factors: {
 *     rankAgreement: 0.70,
 *     scoreConsistency: 1.0, // Single signal = consistent
 *     signalCount: 1,
 *     multiSignalPresence: false
 *   }
 * }
 * ```
 */
interface ConfidenceScore {
  /**
   * Overall confidence in this result (0-1, higher = more confident).
   *
   * Computed as weighted combination of rank agreement, score consistency,
   * and multi-signal presence.
   */
  overall: number;

  /**
   * Component signal strengths that contributed to this result.
   * Only signals that actually contributed will have values.
   */
  signals: {
    /** Normalized dense (vector) similarity score */
    vectorSimilarity?: number;
    /** Normalized sparse (BM25) match score */
    keywordMatch?: number;
    /** Normalized graph context score (if using GraphHybridRetriever) */
    graphContext?: number;
  };

  /**
   * Factors that influenced the overall confidence calculation.
   * Provides transparency into why confidence is high or low.
   */
  factors: {
    /**
     * Agreement between rankers on this result's position (0-1).
     * Higher when result is ranked similarly across methods.
     */
    rankAgreement: number;
    /**
     * Consistency of scores across signals (0-1).
     * Higher when scores from different methods are similar.
     * Single-signal results default to 1.0 (consistent by definition).
     */
    scoreConsistency: number;
    /**
     * Number of signals/rankers that contributed to this result.
     * Range: 1-3 (dense, sparse, graph)
     */
    signalCount: number;
    /**
     * Whether this result appeared in ALL ranker lists.
     * True indicates strong multi-signal support.
     */
    multiSignalPresence: boolean;
  };
}

/**
 * A single retrieval result with scoring transparency.
 *
 * Unlike SearchResult which only has a single score, RetrievalResult
 * provides full breakdown of how the result was ranked.
 */
export interface RetrievalResult {
  /** Unique identifier of the retrieved chunk */
  id: string;
  /** The retrieved chunk content */
  chunk: Chunk;
  /** The final relevance score (higher = more relevant) */
  score: number;
  /**
   * Breakdown of scores by retrieval method.
   * Only present when using hybrid retrieval.
   */
  scores?: HybridScore;
  /** Original rank in dense results (1-indexed, undefined if not in dense results) */
  denseRank?: number;
  /** Original rank in sparse results (1-indexed, undefined if not in sparse results) */
  sparseRank?: number;
  /**
   * Confidence score indicating reliability of this result.
   * Present when using hybrid retrieval with confidence calculation enabled.
   * Higher values indicate multiple retrieval signals agree on relevance.
   */
  confidence?: ConfidenceScore;
}

// ============================================================================
// Retrieval Options
// ============================================================================

/**
 * Options for retrieval queries.
 */
export interface RetrievalOptions {
  /** Maximum number of results to return (default: 10) */
  topK?: number;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Filter results by metadata */
  filter?: MetadataFilter;
  /** Include full metadata in results (default: true) */
  includeMetadata?: boolean;
}

// ============================================================================
// Retriever Interface
// ============================================================================

/**
 * Interface for all retrievers.
 *
 * Retrievers are responsible for finding relevant chunks given a query.
 * Implementations may use vector similarity, keyword matching, or both.
 *
 * @example
 * ```typescript
 * const retriever: Retriever = new HybridRetriever({
 *   vectorStore,
 *   embeddingProvider,
 *   documents,
 * });
 *
 * const results = await retriever.retrieve('How do I reset my password?', {
 *   topK: 5,
 *   alpha: 0.7, // favor semantic search
 * });
 * ```
 */
export interface Retriever {
  /** Human-readable name of this retriever */
  readonly name: string;

  /**
   * Retrieve relevant chunks for a query.
   *
   * @param query - The search query (natural language)
   * @param options - Retrieval options (topK, filters, etc.)
   * @returns Array of results sorted by relevance (descending)
   */
  retrieve(
    query: string,
    options?: RetrievalOptions
  ): Promise<RetrievalResult[]>;
}

// ============================================================================
// BM25 Configuration
// ============================================================================

/**
 * Configuration for BM25 sparse retriever.
 *
 * BM25 (Best Matching 25) is a bag-of-words retrieval function that
 * ranks documents based on query term frequency and document length.
 */
export interface BM25Config {
  /**
   * Term frequency saturation parameter.
   * Controls how much a term's frequency contributes to the score.
   * Higher values give more weight to term frequency.
   * Default: 1.2 (standard value)
   */
  k1?: number;

  /**
   * Document length normalization parameter.
   * Controls how much document length affects scoring.
   * - 0 = no length normalization
   * - 1 = full length normalization
   * Default: 0.75 (standard value)
   */
  b?: number;

  /**
   * Custom tokenizer function.
   * If not provided, uses default whitespace + punctuation tokenizer.
   */
  tokenizer?: (text: string) => string[];

  /**
   * Minimum document frequency for a term to be included.
   * Terms appearing in fewer documents are ignored.
   * Default: 1 (include all terms)
   */
  minDocFreq?: number;

  /**
   * Maximum document frequency ratio for a term (0-1).
   * Terms appearing in more than this ratio of documents are ignored.
   * Useful for filtering common words.
   * Default: 1.0 (include all terms)
   */
  maxDocFreqRatio?: number;
}

/**
 * A document prepared for BM25 indexing.
 * Must have an id and content at minimum.
 */
export interface BM25Document {
  /** Unique identifier */
  id: string;
  /** Text content to index */
  content: string;
  /** Original chunk (preserved for retrieval results) */
  chunk: Chunk;
}

// ============================================================================
// Dense Retriever Configuration
// ============================================================================

/**
 * Configuration for dense (vector) retriever.
 */
export interface DenseRetrieverConfig {
  /** Name for this retriever instance */
  name?: string;
}

// ============================================================================
// RRF Types
// ============================================================================

/**
 * A ranked item for RRF fusion.
 */
export interface RankedItem {
  /** Item identifier */
  id: string;
  /** Rank in this list (1-indexed) */
  rank: number;
  /** Original score from this ranker */
  score: number;
  /** The chunk data */
  chunk: Chunk;
}

/**
 * Result of RRF fusion.
 */
export interface RRFResult {
  /** Item identifier */
  id: string;
  /** Fused RRF score */
  score: number;
  /** The chunk data */
  chunk: Chunk;
  /** Contribution from each ranker */
  contributions: {
    /** Ranker name */
    name: string;
    /** Rank in this ranker's list (undefined if not present) */
    rank?: number;
    /** Original score from this ranker (undefined if not present) */
    score?: number;
    /** RRF contribution to final score */
    contribution: number;
  }[];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for retrieval failures.
 */
export type RetrieverErrorCode =
  | 'INVALID_QUERY'
  | 'RETRIEVAL_FAILED'
  | 'CONFIG_ERROR'
  | 'INDEX_NOT_BUILT'
  | 'EMBEDDING_FAILED'
  | 'STORE_ERROR';

/**
 * Details about a retriever error.
 */
export interface RetrieverErrorDetails {
  /** Machine-readable error code */
  code: RetrieverErrorCode;
  /** Name of the retriever that failed */
  retrieverName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
