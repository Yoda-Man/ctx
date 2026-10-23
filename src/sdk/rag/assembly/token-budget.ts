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
 * - GPT models: ~4 characters per token for English
 * - Claude models: similar ratio
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
export function estimateChunkTokens(
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
  overflowStrategy: 'drop',
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
  /** Whether any chunks were truncated */
  wasTruncated: boolean;
}

/**
 * Apply token budget to a list of chunks.
 *
 * Processes chunks in order, including as many as fit within budget.
 * Handles overflow according to the configured strategy.
 *
 * @param chunks - Chunks to process (in desired order)
 * @param budget - Maximum tokens to use
 * @param overflowStrategy - How to handle chunks that exceed remaining budget
 * @param formattingOverhead - Extra chars per chunk for formatting
 * @returns Result with included/dropped chunks and token stats
 *
 * @example
 * ```typescript
 * const result = applyTokenBudget(chunks, 1000, 'drop');
 * console.log(`Included ${result.included.length} chunks`);
 * console.log(`Used ${result.usedTokens} of 1000 tokens`);
 * ```
 */
export function applyTokenBudget(
  chunks: Chunk[],
  budget: number,
  overflowStrategy: 'truncate' | 'drop' = 'drop',
  formattingOverhead: number = 50
): BudgetResult {
  const included: Chunk[] = [];
  const dropped: Chunk[] = [];
  let usedTokens = 0;
  let wasTruncated = false;

  for (const chunk of chunks) {
    const chunkTokens = estimateChunkTokens(chunk, formattingOverhead);
    const newTotal = usedTokens + chunkTokens;

    if (newTotal <= budget) {
      // Chunk fits completely
      included.push(chunk);
      usedTokens = newTotal;
    } else if (overflowStrategy === 'truncate' && usedTokens < budget) {
      // Truncate chunk to fit remaining budget
      const remainingTokens = budget - usedTokens;
      const remainingChars =
        (remainingTokens - Math.ceil(formattingOverhead / CHARS_PER_TOKEN)) *
        CHARS_PER_TOKEN;

      if (remainingChars > 100) {
        // Only truncate if we can include meaningful content
        const truncatedChunk: Chunk = {
          ...chunk,
          content: truncateText(chunk.content, remainingChars),
        };
        included.push(truncatedChunk);
        usedTokens = budget;
        wasTruncated = true;
      } else {
        dropped.push(chunk);
      }
    } else {
      // Drop chunk entirely
      dropped.push(chunk);
    }
  }

  return {
    included,
    dropped,
    usedTokens,
    remainingTokens: Math.max(0, budget - usedTokens),
    wasTruncated,
  };
}

/**
 * Truncate text to approximately the target character count.
 *
 * Tries to break at word boundaries for readability.
 * Adds ellipsis to indicate truncation.
 *
 * @param text - Text to truncate
 * @param maxChars - Maximum characters (including ellipsis)
 * @returns Truncated text with ellipsis
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const ellipsis = '...';
  const targetLength = maxChars - ellipsis.length;

  if (targetLength <= 0) {
    return ellipsis;
  }

  // Try to break at word boundary
  let truncated = text.slice(0, targetLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > targetLength * 0.8) {
    // Break at space if it's reasonably close to target
    truncated = truncated.slice(0, lastSpace);
  }

  return truncated.trimEnd() + ellipsis;
}

// ============================================================================
// Budget Analysis
// ============================================================================

/**
 * Analyze how chunks would fill the token budget.
 *
 * Useful for planning and debugging without modifying chunks.
 *
 * @param chunks - Chunks to analyze
 * @param budget - Token budget
 * @param formattingOverhead - Extra chars per chunk for formatting
 * @returns Analysis of budget usage
 */
export function analyzeBudget(
  chunks: Chunk[],
  budget: number,
  formattingOverhead: number = 50
): BudgetAnalysis {
  let totalTokens = 0;
  const chunkAnalysis: ChunkTokenAnalysis[] = [];

  for (const chunk of chunks) {
    const tokens = estimateChunkTokens(chunk, formattingOverhead);
    const cumulativeTokens = totalTokens + tokens;
    const fitsInBudget = cumulativeTokens <= budget;

    chunkAnalysis.push({
      id: chunk.id,
      tokens,
      cumulativeTokens,
      fitsInBudget,
      percentOfBudget: (tokens / budget) * 100,
    });

    totalTokens = cumulativeTokens;
  }

  const includedCount = chunkAnalysis.filter((c) => c.fitsInBudget).length;

  return {
    budget,
    totalChunks: chunks.length,
    totalTokens,
    includedCount,
    droppedCount: chunks.length - includedCount,
    budgetUtilization:
      (Math.min(totalTokens, budget) / budget) * 100,
    chunks: chunkAnalysis,
  };
}

/**
 * Token analysis for a single chunk.
 */
export interface ChunkTokenAnalysis {
  /** Chunk ID */
  id: string;
  /** Estimated tokens for this chunk */
  tokens: number;
  /** Cumulative tokens including this chunk */
  cumulativeTokens: number;
  /** Whether this chunk fits in budget */
  fitsInBudget: boolean;
  /** This chunk's percentage of total budget */
  percentOfBudget: number;
}

/**
 * Analysis of token budget usage.
 */
export interface BudgetAnalysis {
  /** Token budget */
  budget: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Total tokens across all chunks */
  totalTokens: number;
  /** Number of chunks that fit in budget */
  includedCount: number;
  /** Number of chunks that exceed budget */
  droppedCount: number;
  /** Percentage of budget used by included chunks */
  budgetUtilization: number;
  /** Per-chunk analysis */
  chunks: ChunkTokenAnalysis[];
}
