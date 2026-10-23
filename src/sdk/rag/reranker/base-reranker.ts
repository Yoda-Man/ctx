/**
 * Base Reranker
 *
 * Abstract base class for all rerankers.
 * Provides common validation and result transformation logic.
 *
 * Uses the Template Method pattern: subclasses implement _rerank(),
 * and the base class handles validation, normalization, and result transformation.
 */

import type { RetrievalResult } from '../retrieval/types.js';
import type {
  Reranker,
  RerankerOptions,
  RerankerResult,
  RerankerScores,
} from './types.js';
import { RerankerError } from './errors.js';

/**
 * Internal result from subclass _rerank() implementation.
 * Contains the essential scoring information before transformation.
 */
export interface InternalRerankerResult {
  /** Chunk ID */
  id: string;
  /** Reranker's score (may need normalization) */
  score: number;
  /** Original result for reference */
  original: RetrievalResult;
  /** Additional score components (reranker-specific) */
  scoreComponents?: Partial<RerankerScores>;
}

/**
 * Abstract base class for rerankers.
 *
 * Subclasses must implement:
 * - `_rerank()`: Core reranking logic
 *
 * The base class provides:
 * - Input validation
 * - Score normalization (optional)
 * - Result transformation with rank tracking
 * - Filtering by topK and minScore
 *
 * @example
 * ```typescript
 * class MyReranker extends BaseReranker {
 *   readonly name = 'MyReranker';
 *
 *   protected _rerank = async (
 *     query: string,
 *     results: RetrievalResult[]
 *   ): Promise<InternalRerankerResult[]> => {
 *     // Implement custom reranking logic
 *     return results.map((r, i) => ({
 *       id: r.id,
 *       score: computeScore(query, r),
 *       original: r,
 *     }));
 *   };
 * }
 * ```
 */
export abstract class BaseReranker implements Reranker {
  /** Human-readable name of this reranker */
  abstract readonly name: string;

  /**
   * Whether to normalize scores to 0-1 range.
   * Override in subclass if needed.
   */
  protected readonly shouldNormalize: boolean = true;

  /**
   * Public rerank method with validation and transformation.
   *
   * Uses arrow function to preserve `this` binding when passed as callback.
   */
  rerank = async (
    query: string,
    results: RetrievalResult[],
    options?: RerankerOptions
  ): Promise<RerankerResult[]> => {
    // Validate inputs
    this.validateInputs(query, results);

    // Handle empty results
    if (results.length === 0) {
      return [];
    }

    // Call subclass implementation
    const internalResults = await this._rerank(query, results, options);

    // Transform to public result format
    return this.transformResults(internalResults, results, options);
  };

  /**
   * Subclass implementation of reranking logic.
   *
   * @param query - The search query
   * @param results - Results to rerank
   * @param options - Reranking options
   * @returns Internal results with scores
   */
  protected abstract _rerank(
    query: string,
    results: RetrievalResult[],
    options?: RerankerOptions
  ): Promise<InternalRerankerResult[]>;

  /**
   * Validate inputs before reranking.
   */
  protected validateInputs(query: string, results: RetrievalResult[]): void {
    if (!query || typeof query !== 'string') {
      throw RerankerError.invalidInput(this.name, 'Query must be a non-empty string');
    }

    if (!Array.isArray(results)) {
      throw RerankerError.invalidInput(this.name, 'Results must be an array');
    }
  }

  /**
   * Transform internal results to public format.
   *
   * Handles:
   * - Score normalization
   * - Rank assignment
   * - Filtering by topK and minScore
   * - Score breakdown inclusion
   */
  protected transformResults(
    internalResults: InternalRerankerResult[],
    originalResults: RetrievalResult[],
    options?: RerankerOptions
  ): RerankerResult[] {
    const { topK, minScore, includeScoreBreakdown = true } = options ?? {};

    // Create a map for O(1) original rank lookup
    const originalRankMap = new Map<string, number>();
    originalResults.forEach((r, i) => {
      originalRankMap.set(r.id, i + 1); // 1-indexed
    });

    // Sort by score descending
    const sorted = [...internalResults].sort((a, b) => b.score - a.score);

    // Normalize scores if needed
    const normalized = this.shouldNormalize
      ? this.normalizeScores(sorted)
      : sorted;

    // Filter by minScore if specified
    let filtered = normalized;
    if (minScore !== undefined) {
      filtered = normalized.filter((r) => r.score >= minScore);
    }

    // Apply topK limit
    const limited = topK !== undefined ? filtered.slice(0, topK) : filtered;

    // Transform to public format
    return limited.map((r, newIndex) => {
      const originalRank = originalRankMap.get(r.id) ?? 0;
      const newRank = newIndex + 1; // 1-indexed

      const scores: RerankerScores = {
        originalScore: r.original.score,
        rerankerScore: r.score,
        ...r.scoreComponents,
      };

      return {
        id: r.id,
        chunk: r.original.chunk,
        score: r.score,
        originalRank,
        newRank,
        scores: includeScoreBreakdown ? scores : { originalScore: r.original.score, rerankerScore: r.score },
      };
    });
  }

  /**
   * Normalize scores to 0-1 range using min-max normalization.
   *
   * Handles edge cases:
   * - Single result: score becomes 1.0
   * - All same scores: all become 1.0
   */
  protected normalizeScores(
    results: InternalRerankerResult[]
  ): InternalRerankerResult[] {
    if (results.length === 0) {
      return results;
    }

    const scores = results.map((r) => r.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    // If all scores are the same, return 1.0 for all
    if (range === 0) {
      return results.map((r) => ({ ...r, score: 1.0 }));
    }

    return results.map((r) => ({
      ...r,
      score: (r.score - minScore) / range,
    }));
  }
}
