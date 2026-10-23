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
function jaccardSimilarity(textA: string, textB: string): number {
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
function tokenize(text: string): Set<string> {
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
interface DuplicateInfo {
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
