/**
 * Chunk Deduplication
 *
 * Removes near-duplicate chunks to maximize information density.
 * Uses Jaccard similarity on word sets for fast comparison.
 */

import type { RerankerResult } from '../reranker/types.js';
import type { DeduplicationConfig } from './types.js';

// ============================================================================
// Configuration Defaults
// ============================================================================

/**
 * Default deduplication configuration.
 */
export const DEFAULT_DEDUPLICATION_CONFIG: Required<DeduplicationConfig> = {
  enabled: true,
  similarityThreshold: 0.8,
  keepHighestScore: true,
};

// ============================================================================
// Similarity Calculation
// ============================================================================

/**
 * Calculate Jaccard similarity between two texts.
 *
 * Jaccard similarity = |A ∩ B| / |A ∪ B|
 * Where A and B are sets of words.
 *
 * Returns value between 0 (completely different) and 1 (identical).
 *
 * @param textA - First text
 * @param textB - Second text
 * @returns Similarity score between 0 and 1
 *
 * @example
 * ```typescript
 * jaccardSimilarity('hello world', 'hello world'); // 1.0
 * jaccardSimilarity('hello world', 'goodbye world'); // 0.33
 * jaccardSimilarity('hello', 'goodbye'); // 0.0
 * ```
 */
export function jaccardSimilarity(textA: string, textB: string): number {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  if (wordsA.size === 0 && wordsB.size === 0) {
    return 1; // Both empty = identical
  }

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0; // One empty = completely different
  }

  // Calculate intersection
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));

  // Calculate union
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Tokenize text into a set of normalized words.
 *
 * Normalizes by:
 * - Converting to lowercase
 * - Removing punctuation
 * - Filtering out very short words (< 2 chars)
 *
 * @param text - Text to tokenize
 * @returns Set of normalized words
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .split(/\s+/) // Split on whitespace
      .filter((word) => word.length >= 2) // Filter short words
  );
}

// ============================================================================
// Deduplication Logic
// ============================================================================

/**
 * Result of deduplication operation.
 */
export interface DeduplicationResult {
  /** Results after removing duplicates */
  unique: RerankerResult[];
  /** Results that were removed as duplicates */
  duplicates: DuplicateInfo[];
  /** Number of comparisons made */
  comparisons: number;
}

/**
 * Information about a removed duplicate.
 */
export interface DuplicateInfo {
  /** The removed result */
  removed: RerankerResult;
  /** The kept result it was similar to */
  keptId: string;
  /** Similarity score between them */
  similarity: number;
}

/**
 * Remove near-duplicate chunks from results.
 *
 * Uses greedy approach: iterate through results in order,
 * keep each result only if it's not too similar to any kept result.
 *
 * @param results - Results to deduplicate (in relevance order)
 * @param config - Deduplication configuration
 * @returns Deduplication result with unique and removed items
 *
 * @example
 * ```typescript
 * const result = deduplicateResults(results, {
 *   similarityThreshold: 0.8,
 *   keepHighestScore: true,
 * });
 * console.log(`Removed ${result.duplicates.length} duplicates`);
 * ```
 */
export function deduplicateResults(
  results: RerankerResult[],
  config?: DeduplicationConfig
): DeduplicationResult {
  const effectiveConfig = {
    ...DEFAULT_DEDUPLICATION_CONFIG,
    ...config,
  };

  if (!effectiveConfig.enabled || results.length === 0) {
    return {
      unique: [...results],
      duplicates: [],
      comparisons: 0,
    };
  }

  // Sort by score if we want to keep highest scoring
  const sortedResults = effectiveConfig.keepHighestScore
    ? [...results].sort((a, b) => b.score - a.score)
    : [...results];

  const unique: RerankerResult[] = [];
  const duplicates: DuplicateInfo[] = [];
  let comparisons = 0;

  for (const result of sortedResults) {
    let isDuplicate = false;
    let duplicateOf: string | undefined;
    let maxSimilarity = 0;

    // Compare against all kept results
    for (const kept of unique) {
      comparisons++;
      const similarity = jaccardSimilarity(
        result.chunk.content,
        kept.chunk.content
      );

      if (similarity >= effectiveConfig.similarityThreshold) {
        isDuplicate = true;
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          duplicateOf = kept.id;
        }
      }
    }

    if (isDuplicate && duplicateOf) {
      duplicates.push({
        removed: result,
        keptId: duplicateOf,
        similarity: maxSimilarity,
      });
    } else {
      unique.push(result);
    }
  }

  return {
    unique,
    duplicates,
    comparisons,
  };
}

/**
 * Find all pairs of similar chunks above threshold.
 *
 * Useful for analysis and debugging.
 *
 * @param results - Results to analyze
 * @param threshold - Minimum similarity to report
 * @returns Array of similar pairs
 */
export function findSimilarPairs(
  results: RerankerResult[],
  threshold: number = 0.7
): SimilarPair[] {
  const pairs: SimilarPair[] = [];

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const resultI = results[i]!;
      const resultJ = results[j]!;
      const similarity = jaccardSimilarity(
        resultI.chunk.content,
        resultJ.chunk.content
      );

      if (similarity >= threshold) {
        pairs.push({
          idA: resultI.id,
          idB: resultJ.id,
          similarity,
          contentPreviewA: resultI.chunk.content.slice(0, 100),
          contentPreviewB: resultJ.chunk.content.slice(0, 100),
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

/**
 * A pair of similar chunks.
 */
export interface SimilarPair {
  /** First chunk ID */
  idA: string;
  /** Second chunk ID */
  idB: string;
  /** Similarity score */
  similarity: number;
  /** Preview of first chunk content */
  contentPreviewA: string;
  /** Preview of second chunk content */
  contentPreviewB: string;
}

// ============================================================================
// Similarity Analysis
// ============================================================================

/**
 * Analyze similarity distribution in a result set.
 *
 * @param results - Results to analyze
 * @returns Analysis of similarity patterns
 */
export function analyzeSimilarity(results: RerankerResult[]): SimilarityAnalysis {
  if (results.length <= 1) {
    return {
      totalPairs: 0,
      averageSimilarity: 0,
      maxSimilarity: 0,
      minSimilarity: 0,
      pairsAbove50: 0,
      pairsAbove70: 0,
      pairsAbove90: 0,
    };
  }

  const similarities: number[] = [];

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const resultI = results[i]!;
      const resultJ = results[j]!;
      similarities.push(
        jaccardSimilarity(resultI.chunk.content, resultJ.chunk.content)
      );
    }
  }

  return {
    totalPairs: similarities.length,
    averageSimilarity:
      similarities.reduce((a, b) => a + b, 0) / similarities.length,
    maxSimilarity: Math.max(...similarities),
    minSimilarity: Math.min(...similarities),
    pairsAbove50: similarities.filter((s) => s >= 0.5).length,
    pairsAbove70: similarities.filter((s) => s >= 0.7).length,
    pairsAbove90: similarities.filter((s) => s >= 0.9).length,
  };
}

/**
 * Analysis of similarity patterns in results.
 */
export interface SimilarityAnalysis {
  /** Total number of pairs compared */
  totalPairs: number;
  /** Average similarity across all pairs */
  averageSimilarity: number;
  /** Maximum similarity found */
  maxSimilarity: number;
  /** Minimum similarity found */
  minSimilarity: number;
  /** Pairs with similarity >= 0.5 */
  pairsAbove50: number;
  /** Pairs with similarity >= 0.7 */
  pairsAbove70: number;
  /** Pairs with similarity >= 0.9 */
  pairsAbove90: number;
}
