/**
 * Token Budget Management
 *
 * Utilities for estimating token counts and managing token budgets.
 * Ensures assembled context fits within LLM context window limits.
 */

import type { Chunk } from '../vector-store/types.js';
import type { TokenBudgetConfig } from './types.js';

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Average characters per token for estimation.
 *
 * Industry standard approximation:
 * - ~4 characters per token for English text
 * - Code tends to have fewer chars per token (~3.5)
 *
 * We use 4 as a conservative estimate.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string.
 *
 * Uses character-based heuristic (4 chars ≈ 1 token).
 * This is approximate but fast and suitable for budget management.
 *
 * For precise counts, use a model-specific tokenizer.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```typescript
 * estimateTokens('Hello, world!'); // ~4 tokens
 * estimateTokens('A longer sentence with more words.'); // ~9 tokens
 * ```
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a chunk including metadata formatting overhead.
 *
 * Accounts for the additional tokens used by source attribution
 * and formatting (XML tags, markdown markers, etc.).
 *
 * @param chunk - Chunk to estimate
 * @param formattingOverhead - Extra characters for formatting (default: 50)
 * @returns Estimated total token count
 */
function estimateChunkTokens(
  chunk: Chunk,
  formattingOverhead: number = 50
): number {
  const contentTokens = estimateTokens(chunk.content);
  const overheadTokens = Math.ceil(formattingOverhead / CHARS_PER_TOKEN);
  return contentTokens + overheadTokens;
}

// ============================================================================
// Budget Calculation
// ============================================================================

/**
 * Default token budget configuration.
 */
export const DEFAULT_TOKEN_BUDGET: Required<TokenBudgetConfig> = {
  maxTokens: 4096,
  contextWindowSize: 8192,
  budgetPercentage: 0.5,
};

/**
 * Calculate the effective token budget from configuration.
 *
 * Priority:
 * 1. Explicit maxTokens if provided
 * 2. Calculated from contextWindowSize * budgetPercentage
 *
 * @param config - Token budget configuration
 * @returns Effective maximum tokens
 */
export function calculateTokenBudget(config?: TokenBudgetConfig): number {
  if (!config) {
    return DEFAULT_TOKEN_BUDGET.maxTokens;
  }

  // Explicit maxTokens takes priority
  if (config.maxTokens !== undefined) {
    return config.maxTokens;
  }

  // Calculate from context window and percentage
  const windowSize = config.contextWindowSize ?? DEFAULT_TOKEN_BUDGET.contextWindowSize;
  const percentage = config.budgetPercentage ?? DEFAULT_TOKEN_BUDGET.budgetPercentage;

  return Math.floor(windowSize * percentage);
}

// ============================================================================
// Budget Enforcement
// ============================================================================

/**
 * Result of applying token budget to chunks.
 */
export interface BudgetResult {
  /** Chunks that fit within budget */
  included: Chunk[];
  /** Chunks dropped due to budget */
  dropped: Chunk[];
  /** Total tokens used by included chunks */
  usedTokens: number;
  /** Remaining token budget */
  remainingTokens: number;
}

/**
 * Apply token budget to a list of chunks.
 *
 * Processes chunks in order, including each one that fits within the budget
 * and dropping the rest.
 *
 * @param chunks - Chunks to process (in desired order)
 * @param budget - Maximum tokens to use
 * @param formattingOverhead - Extra chars per chunk for formatting
 * @returns Result with included/dropped chunks and token stats
 *
 * @example
 * ```typescript
 * const result = applyTokenBudget(chunks, 1000);
 * console.log(`Included ${result.included.length} chunks`);
 * console.log(`Used ${result.usedTokens} of 1000 tokens`);
 * ```
 */
export function applyTokenBudget(
  chunks: Chunk[],
  budget: number,
  formattingOverhead: number = 50
): BudgetResult {
  const included: Chunk[] = [];
  const dropped: Chunk[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    const chunkTokens = estimateChunkTokens(chunk, formattingOverhead);
    if (usedTokens + chunkTokens <= budget) {
      included.push(chunk);
      usedTokens += chunkTokens;
    } else {
      dropped.push(chunk);
    }
  }

  return {
    included,
    dropped,
    usedTokens,
    remainingTokens: Math.max(0, budget - usedTokens),
  };
}
