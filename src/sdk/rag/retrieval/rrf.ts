/**
 * Reciprocal Rank Fusion (RRF)
 *
 * Combines multiple ranking lists into a single unified ranking.
 * Used by HybridRetriever to fuse dense and sparse results.
 *
 * RRF is particularly effective because:
 * 1. It doesn't require score normalization across rankers
 * 2. It's robust to outliers (bad rank in one list doesn't dominate)
 * 3. Documents appearing in multiple lists get a significant boost
 */

import type { Chunk } from '../vector-store/types.js';
import type { RankedItem, RRFResult } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default RRF k parameter.
 *
 * k=60 is the standard value from the original RRF paper.
 * It provides a good balance between:
 * - Giving significant weight to top-ranked items
 * - Not over-penalizing items with lower ranks
 */
export const DEFAULT_RRF_K = 60;

// ============================================================================
// RRF Implementation
// ============================================================================

/**
 * A single ranking list with its source name.
 */
export interface RankingList {
  /** Name of this ranker (e.g., "dense", "sparse") */
  name: string;
  /** Ranked items from this ranker */
  items: RankedItem[];
}

/**
 * Fuse multiple ranking lists using Reciprocal Rank Fusion.
 *
 * The formula is: RRFscore(d) = Σ 1/(k + rank_i(d))
 *
 * Where:
 * - d is a document
 * - rank_i(d) is the rank of d in list i (1-indexed)
 * - k is a smoothing constant (default: 60)
 *
 * @param rankings - Array of ranking lists to fuse
 * @param k - RRF k parameter (default: 60)
 * @returns Fused results sorted by RRF score (descending)
 *
 * @example
 * ```typescript
 * const denseRanking = {
 *   name: 'dense',
 *   items: [
 *     { id: 'a', rank: 1, score: 0.95, chunk: {...} },
 *     { id: 'b', rank: 2, score: 0.87, chunk: {...} },
 *   ]
 * };
 *
 * const sparseRanking = {
 *   name: 'sparse',
 *   items: [
 *     { id: 'b', rank: 1, score: 0.90, chunk: {...} },
 *     { id: 'c', rank: 2, score: 0.75, chunk: {...} },
 *   ]
 * };
 *
 * const fused = reciprocalRankFusion([denseRanking, sparseRanking]);
 * // Result: [
 * //   { id: 'b', score: 0.0328, contributions: [...] }, // In both lists
 * //   { id: 'a', score: 0.0164, contributions: [...] }, // Only in dense
 * //   { id: 'c', score: 0.0161, contributions: [...] }, // Only in sparse
 * // ]
 * ```
 */
export const reciprocalRankFusion = (
  rankings: RankingList[],
  k: number = DEFAULT_RRF_K
): RRFResult[] => {
  if (rankings.length === 0) {
    return [];
  }

  // Map from document ID to accumulated RRF data
  const fusedMap = new Map<
    string,
    {
      id: string;
      chunk: Chunk;
      score: number;
      contributions: RRFResult['contributions'];
    }
  >();

  // Process each ranking list
  for (const ranking of rankings) {
    for (const item of ranking.items) {
      // Calculate RRF contribution for this item from this ranker
      const contribution = 1 / (k + item.rank);

      if (!fusedMap.has(item.id)) {
        // First time seeing this document
        fusedMap.set(item.id, {
          id: item.id,
          chunk: item.chunk,
          score: contribution,
          contributions: [
            {
              name: ranking.name,
              rank: item.rank,
              score: item.score,
              contribution,
            },
          ],
        });
      } else {
        // Document already seen - add contribution
        const existing = fusedMap.get(item.id)!;
        existing.score += contribution;
        existing.contributions.push({
          name: ranking.name,
          rank: item.rank,
          score: item.score,
          contribution,
        });
      }
    }
  }

  // Add zero-contribution entries for documents not in a ranker
  // This provides complete transparency in the results
  for (const [, fused] of fusedMap) {
    for (const ranking of rankings) {
      const hasContribution = fused.contributions.some(
        (c) => c.name === ranking.name
      );
      if (!hasContribution) {
        fused.contributions.push({
          name: ranking.name,
          rank: undefined,
          score: undefined,
          contribution: 0,
        });
      }
    }
  }

  // Sort by fused score (descending) and return
  return [...fusedMap.values()].sort((a, b) => b.score - a.score);
};

/**
 * Calculate the RRF score contribution for a given rank.
 *
 * @param rank - The rank (1-indexed)
 * @param k - RRF k parameter (default: 60)
 * @returns RRF contribution value
 */
export const rrfScore = (rank: number, k: number = DEFAULT_RRF_K): number => {
  return 1 / (k + rank);
};

/**
 * Calculate the maximum possible RRF score for N rankers.
 *
 * This is useful for normalizing RRF scores to 0-1 range.
 * The max score occurs when a document is ranked #1 in all rankers.
 *
 * @param numRankers - Number of ranking lists
 * @param k - RRF k parameter (default: 60)
 * @returns Maximum possible RRF score
 */
export const maxRRFScore = (
  numRankers: number,
  k: number = DEFAULT_RRF_K
): number => {
  // Max score = sum of 1/(k+1) for each ranker
  return numRankers * (1 / (k + 1));
};

/**
 * Normalize RRF scores to 0-1 range.
 *
 * Uses the theoretical maximum score (ranked #1 in all lists) as the normalizer.
 *
 * @param results - RRF results to normalize
 * @param numRankers - Number of ranking lists used
 * @param k - RRF k parameter (default: 60)
 * @returns Results with normalized scores
 */
export const normalizeRRFScores = (
  results: RRFResult[],
  numRankers: number,
  k: number = DEFAULT_RRF_K
): RRFResult[] => {
  const maxScore = maxRRFScore(numRankers, k);

  return results.map((result) => ({
    ...result,
    score: result.score / maxScore,
  }));
};
