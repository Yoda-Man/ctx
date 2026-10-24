/**
 * Token Counter Utilities
 *
 * Provides token estimation for text chunking.
 * Uses a heuristic approach (~4 characters = 1 token) that works
 * across different LLM providers without external dependencies.
 */

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
