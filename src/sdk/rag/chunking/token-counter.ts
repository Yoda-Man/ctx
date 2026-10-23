/**
 * Token Counter Utilities
 *
 * Provides token estimation for text chunking.
 * Uses a heuristic approach (~4 characters = 1 token) that works
 * across different LLM providers without external dependencies.
 */

import type { SizeUnit } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Average characters per token.
 *
 * This heuristic is based on GPT tokenizers where:
 * - Common English words: ~1 token per 4-5 chars
 * - Whitespace and punctuation: often separate tokens
 * - Code/special chars: more tokens per char
 *
 * 4 is a conservative estimate that works well for chunking.
 */
export const CHARS_PER_TOKEN = 4;

// ============================================================================
// Token Counting Functions
// ============================================================================

/**
 * Estimate the number of tokens in a text string.
 *
 * Uses a simple heuristic: tokens ≈ characters / 4
 *
 * @param text - The text to count tokens for
 * @returns Estimated token count (always >= 0)
 *
 * @example
 * ```typescript
 * estimateTokens('Hello, world!'); // => 4 (13 chars / 4 ≈ 3.25, rounded up)
 * estimateTokens(''); // => 0
 * ```
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Count characters in a text string.
 *
 * @param text - The text to count characters for
 * @returns Character count (always >= 0)
 */
export function countCharacters(text: string): number {
  return text?.length ?? 0;
}

/**
 * Measure text size using the specified unit.
 *
 * @param text - The text to measure
 * @param unit - 'tokens' or 'characters'
 * @returns Size in the specified unit
 *
 * @example
 * ```typescript
 * measureSize('Hello, world!', 'tokens'); // => 4
 * measureSize('Hello, world!', 'characters'); // => 13
 * ```
 */
export function measureSize(text: string, unit: SizeUnit): number {
  return unit === 'tokens' ? estimateTokens(text) : countCharacters(text);
}

/**
 * Convert a size from one unit to another.
 *
 * @param size - The size value
 * @param fromUnit - Source unit
 * @param toUnit - Target unit
 * @returns Converted size
 *
 * @example
 * ```typescript
 * convertSize(100, 'tokens', 'characters'); // => 400
 * convertSize(400, 'characters', 'tokens'); // => 100
 * ```
 */
export function convertSize(
  size: number,
  fromUnit: SizeUnit,
  toUnit: SizeUnit
): number {
  if (fromUnit === toUnit) return size;

  if (fromUnit === 'tokens' && toUnit === 'characters') {
    return size * CHARS_PER_TOKEN;
  }

  // characters to tokens
  return Math.ceil(size / CHARS_PER_TOKEN);
}

/**
 * Find the index where text exceeds a size limit.
 *
 * Useful for splitting text at a target size boundary.
 *
 * @param text - The text to search
 * @param targetSize - Maximum size
 * @param unit - Size unit
 * @returns Index where size is exceeded, or text.length if under limit
 *
 * @example
 * ```typescript
 * // Find where we hit 10 tokens
 * const idx = findSizeIndex('This is a sample text for testing', 10, 'tokens');
 * const chunk = text.slice(0, idx); // First 10 tokens worth
 * ```
 */
export function findSizeIndex(
  text: string,
  targetSize: number,
  unit: SizeUnit
): number {
  if (!text || targetSize <= 0) return 0;

  // Convert target to characters for direct indexing
  const targetChars =
    unit === 'tokens' ? targetSize * CHARS_PER_TOKEN : targetSize;

  // Don't exceed actual text length
  return Math.min(targetChars, text.length);
}

/**
 * Split text into segments of approximately equal size.
 *
 * Note: This is a utility for fixed-size chunking. Segments may be
 * slightly smaller than targetSize due to rounding.
 *
 * @param text - Text to split
 * @param targetSize - Target size per segment
 * @param unit - Size unit
 * @param overlap - Overlap between segments (default: 0)
 * @returns Array of text segments
 */
export function splitBySize(
  text: string,
  targetSize: number,
  unit: SizeUnit,
  overlap: number = 0
): string[] {
  if (!text || targetSize <= 0) return [];

  const targetChars =
    unit === 'tokens' ? targetSize * CHARS_PER_TOKEN : targetSize;
  const overlapChars = unit === 'tokens' ? overlap * CHARS_PER_TOKEN : overlap;

  const segments: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + targetChars, text.length);
    segments.push(text.slice(start, end));

    // Move forward by (targetSize - overlap)
    const step = targetChars - overlapChars;
    if (step <= 0) {
      // Prevent infinite loop if overlap >= targetSize
      start = end;
    } else {
      start += step;
    }
  }

  return segments;
}
