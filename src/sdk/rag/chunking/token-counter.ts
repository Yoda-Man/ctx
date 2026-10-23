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
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Count characters in a text string.
 *
 * @param text - The text to count characters for
 * @returns Character count (always >= 0)
 */
function countCharacters(text: string): number {
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
