/**
 * Ordering Strategies
 *
 * Functions for ordering chunks in assembled context.
 * Addresses the "lost in the middle" phenomenon where LLMs pay
 * more attention to content at the beginning and end of context.
 */

import type { RerankerResult } from '../reranker/types.js';
import type { OrderingStrategy } from './types.js';

/**
 * Apply ordering strategy to reranked results.
 *
 * @param results - Reranked results (already sorted by score descending)
 * @param strategy - Ordering strategy to apply
 * @param sandwichStartCount - For 'sandwich': how many top items at start
 * @returns Results in the requested order
 *
 * @example
 * ```typescript
 * // Sandwich ordering: put best at edges
 * const ordered = applyOrdering(results, 'sandwich', 3);
 * // [1st, 2nd, 3rd, 8th, 7th, 6th, 5th, 4th]
 * //  ^---------^     ^-------------------^
 * //  top 3 at start  remaining in reverse at end
 * ```
 */
export function applyOrdering(
  results: RerankerResult[],
  strategy: OrderingStrategy,
  sandwichStartCount?: number
): RerankerResult[] {
  if (results.length === 0) {
    return [];
  }

  switch (strategy) {
    case 'relevance':
      return orderByRelevance(results);

    case 'sandwich':
      return orderBySandwich(results, sandwichStartCount);

    case 'chronological':
      return orderChronologically(results);

    default: {
      // TypeScript exhaustiveness check - ensures all cases handled
      const exhaustiveCheck: never = strategy;
      throw new Error(`Unhandled ordering strategy: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Order by relevance score descending (default).
 *
 * Results are typically already in this order from reranking,
 * but this ensures consistency.
 */
export function orderByRelevance(results: RerankerResult[]): RerankerResult[] {
  return [...results].sort((a, b) => b.score - a.score);
}

/**
 * Sandwich ordering: most relevant at start and end.
 *
 * This mitigates the "lost in the middle" problem where LLMs
 * attend less to content in the middle of the context.
 *
 * Algorithm:
 * 1. Take top `startCount` items for the beginning
 * 2. Place remaining items at the end in reverse relevance order
 *
 * Example with 8 items, startCount=3:
 * Input (by relevance):  [1, 2, 3, 4, 5, 6, 7, 8]
 * Output (sandwich):     [1, 2, 3, 8, 7, 6, 5, 4]
 *
 * The most relevant items (1, 2, 3) are at the start where
 * they get high attention. The next most relevant (4, 5) are
 * at the end where attention recovers. The least relevant
 * items (6, 7, 8) are buried in the middle.
 *
 * @param results - Results sorted by relevance descending
 * @param startCount - Number of top items to place at start (default: half)
 */
export function orderBySandwich(
  results: RerankerResult[],
  startCount?: number
): RerankerResult[] {
  if (results.length <= 2) {
    return [...results];
  }

  // Default: half at start (rounded up)
  const effectiveStartCount = startCount ?? Math.ceil(results.length / 2);

  // Clamp to valid range
  const clampedStartCount = Math.max(
    1,
    Math.min(effectiveStartCount, results.length - 1)
  );

  // Sort by relevance first
  const sorted = orderByRelevance(results);

  // Split into start and remaining
  const startItems = sorted.slice(0, clampedStartCount);
  const remainingItems = sorted.slice(clampedStartCount);

  // Reverse remaining items so lower-relevance items are in the middle
  // and higher-relevance items are at the end
  const reversedRemaining = remainingItems.reverse();

  return [...startItems, ...reversedRemaining];
}

/**
 * Order chronologically by document position.
 *
 * Uses chunk metadata to determine original document order:
 * 1. Sort by documentId (group chunks from same document)
 * 2. Then by startIndex within each document
 *
 * Falls back to relevance order if metadata is missing.
 */
export function orderChronologically(
  results: RerankerResult[]
): RerankerResult[] {
  return [...results].sort((a, b) => {
    // First, group by document
    const docA = a.chunk.documentId ?? '';
    const docB = b.chunk.documentId ?? '';
    if (docA !== docB) {
      return docA.localeCompare(docB);
    }

    // Within same document, order by position
    const posA = a.chunk.metadata?.startIndex ?? Number.MAX_SAFE_INTEGER;
    const posB = b.chunk.metadata?.startIndex ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) {
      return posA - posB;
    }

    // Fallback to relevance if positions are equal
    return b.score - a.score;
  });
}

/**
 * Analyze the current ordering to provide insights.
 *
 * Useful for debugging and understanding how ordering affects attention.
 *
 * @returns Analysis object with distribution information
 */
export function analyzeOrdering(results: RerankerResult[]): OrderingAnalysis {
  if (results.length === 0) {
    return {
      totalCount: 0,
      averageScore: 0,
      scoreDistribution: { start: 0, middle: 0, end: 0 },
      highAttentionScoreSum: 0,
      middleScoreSum: 0,
    };
  }

  const scores = results.map((r) => r.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Divide into thirds: start, middle, end
  const third = Math.ceil(results.length / 3);
  const startScores = scores.slice(0, third);
  const endScores = scores.slice(-third);
  const middleScores = scores.slice(third, -third || undefined);

  const sum = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) : 0;
  const avg = (arr: number[]) => (arr.length > 0 ? sum(arr) / arr.length : 0);

  return {
    totalCount: results.length,
    averageScore: avgScore,
    scoreDistribution: {
      start: avg(startScores),
      middle: avg(middleScores),
      end: avg(endScores),
    },
    // High attention zones: start + end
    highAttentionScoreSum: sum(startScores) + sum(endScores),
    // Low attention zone: middle
    middleScoreSum: sum(middleScores),
  };
}

/**
 * Analysis of chunk ordering.
 */
export interface OrderingAnalysis {
  /** Total number of chunks */
  totalCount: number;
  /** Average relevance score across all chunks */
  averageScore: number;
  /** Average scores by position (start/middle/end thirds) */
  scoreDistribution: {
    start: number;
    middle: number;
    end: number;
  };
  /** Sum of scores in high-attention zones (start + end) */
  highAttentionScoreSum: number;
  /** Sum of scores in low-attention zone (middle) */
  middleScoreSum: number;
}
