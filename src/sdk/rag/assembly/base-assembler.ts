/**
 * Base Context Assembler
 *
 * Abstract base class implementing the Template Method pattern.
 * Handles common logic (ordering, deduplication, token budget) while
 * delegating formatting to concrete implementations.
 */

import type { Chunk } from '../vector-store/types.js';
import type { RerankerResult } from '../reranker/types.js';
import type {
  ContextAssembler,
  AssemblerConfig,
  AssemblyOptions,
  AssembledContext,
  SourceAttribution,
} from './types.js';
import { AssemblyError } from './errors.js';
import { applyOrdering } from './ordering.js';
import {
  applyTokenBudget,
  calculateTokenBudget,
  estimateTokens,
  DEFAULT_TOKEN_BUDGET,
} from './token-budget.js';
import {
  deduplicateResults,
  DEFAULT_DEDUPLICATION_CONFIG,
} from './deduplication.js';

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default assembler configuration.
 */
export const DEFAULT_ASSEMBLER_CONFIG: Required<
  Omit<AssemblerConfig, 'tokenBudget' | 'deduplication'>
> & {
  tokenBudget: typeof DEFAULT_TOKEN_BUDGET;
  deduplication: typeof DEFAULT_DEDUPLICATION_CONFIG;
} = {
  name: 'BaseAssembler',
  ordering: 'relevance',
  sandwichStartCount: undefined as unknown as number,
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  deduplication: DEFAULT_DEDUPLICATION_CONFIG,
  includeSourceAttribution: true,
  includeScores: false,
};

// ============================================================================
// Base Assembler
// ============================================================================

/**
 * Abstract base class for context assemblers.
 *
 * Implements the Template Method pattern:
 * - Public `assemble()` handles orchestration (validation, ordering, dedup, budget)
 * - Protected `_format()` is implemented by subclasses for specific output formats
 *
 * @example
 * ```typescript
 * class CustomAssembler extends BaseAssembler {
 *   readonly name = 'CustomAssembler';
 *
 *   protected _format(chunks, sources, options) {
 *     return chunks.map(c => c.content).join('\n\n');
 *   }
 * }
 * ```
 */
export abstract class BaseAssembler implements ContextAssembler {
  /** Human-readable name of this assembler */
  abstract readonly name: string;

  /** Configuration for this assembler */
  protected readonly config: Required<
    Omit<AssemblerConfig, 'tokenBudget' | 'deduplication'>
  > & {
    tokenBudget: typeof DEFAULT_TOKEN_BUDGET;
    deduplication: typeof DEFAULT_DEDUPLICATION_CONFIG;
  };

  constructor(config?: AssemblerConfig) {
    this.config = {
      ...DEFAULT_ASSEMBLER_CONFIG,
      ...config,
      tokenBudget: {
        ...DEFAULT_TOKEN_BUDGET,
        ...config?.tokenBudget,
      },
      deduplication: {
        ...DEFAULT_DEDUPLICATION_CONFIG,
        ...config?.deduplication,
      },
    };
  }

  /**
   * Assemble reranked results into formatted context.
   *
   * Pipeline:
   * 1. Validate input
   * 2. Apply topK limit
   * 3. Deduplicate similar chunks
   * 4. Apply ordering strategy
   * 5. Apply token budget
   * 6. Build source attributions
   * 7. Format output (delegated to subclass)
   *
   * @param results - Reranked results from the reranking stage
   * @param options - Assembly options (can override config)
   * @returns Assembled context with formatted string and metadata
   */
  assemble = async (
    results: RerankerResult[],
    options?: AssemblyOptions
  ): Promise<AssembledContext> => {
    // Step 1: Validate input
    this.validateInput(results);

    // Step 2: Apply topK limit
    const topK = options?.topK ?? results.length;
    let working = results.slice(0, topK);

    // Step 3: Deduplicate
    const deduplicationThreshold =
      options?.deduplicationThreshold ?? this.config.deduplication.similarityThreshold;
    const deduplicationResult = deduplicateResults(working, {
      ...this.config.deduplication,
      similarityThreshold: deduplicationThreshold,
    });
    working = deduplicationResult.unique;
    const deduplicatedCount = deduplicationResult.duplicates.length;

    // Step 4: Apply ordering
    const ordering = options?.ordering ?? this.config.ordering;
    working = applyOrdering(working, ordering, this.config.sandwichStartCount);

    // Step 5: Apply token budget
    const maxTokens =
      options?.maxTokens ?? calculateTokenBudget(this.config.tokenBudget);
    const budgetResult = applyTokenBudget(
      working.map((r) => r.chunk),
      maxTokens,
      this.config.tokenBudget.overflowStrategy,
      this.getFormattingOverhead()
    );

    // Map back to results for chunks that were included
    const includedChunkIds = new Set(budgetResult.included.map((c) => c.id));
    const includedResults = working.filter((r) =>
      includedChunkIds.has(r.chunk.id)
    );
    const droppedCount = working.length - includedResults.length;

    // Step 6: Build source attributions
    const sources = this.buildSourceAttributions(includedResults);

    // Step 7: Format output (delegated to subclass)
    const formattedContent = await this._format(
      budgetResult.included,
      sources,
      options
    );

    // Add preamble/postamble if provided
    const parts: string[] = [];
    if (options?.preamble) {
      parts.push(options.preamble);
    }
    parts.push(formattedContent);
    if (options?.postamble) {
      parts.push(options.postamble);
    }
    const finalContent = parts.join('\n\n');

    return {
      content: finalContent,
      estimatedTokens: estimateTokens(finalContent),
      chunkCount: budgetResult.included.length,
      deduplicatedCount,
      droppedCount,
      sources,
      chunks: budgetResult.included,
    };
  };

  /**
   * Format chunks into the output string.
   *
   * Implemented by subclasses to provide specific output formats
   * (XML, Markdown, etc.).
   *
   * @param chunks - Chunks to format (already ordered and filtered)
   * @param sources - Source attributions for each chunk
   * @param options - Assembly options
   * @returns Formatted context string
   */
  protected abstract _format(
    chunks: Chunk[],
    sources: SourceAttribution[],
    options?: AssemblyOptions
  ): Promise<string>;

  /**
   * Get the estimated formatting overhead per chunk in characters.
   *
   * Override in subclasses if formatting adds significant overhead.
   * Used for token budget calculations.
   *
   * @returns Characters of overhead per chunk
   */
  protected getFormattingOverhead(): number {
    return 50; // Default: ~12 tokens of overhead per chunk
  }

  /**
   * Validate input results.
   *
   * @throws {AssemblyError} If input is invalid
   */
  protected validateInput(results: RerankerResult[]): void {
    if (!Array.isArray(results)) {
      throw AssemblyError.invalidInput(
        this.name,
        'Results must be an array'
      );
    }

    // Empty array is valid (returns empty context)
    if (results.length === 0) {
      return;
    }

    // Validate structure of first result
    const first = results[0]!;
    if (!first.chunk || typeof first.chunk.content !== 'string') {
      throw AssemblyError.invalidInput(
        this.name,
        'Results must have chunk.content string'
      );
    }
  }

  /**
   * Build source attributions for included results.
   *
   * @param results - Results to build attributions for
   * @returns Array of source attributions
   */
  protected buildSourceAttributions(
    results: RerankerResult[]
  ): SourceAttribution[] {
    return results.map((result, index) => {
      const metadata = result.chunk.metadata ?? {};

      // Build location string from available metadata
      let location: string | undefined;
      if (metadata.pageNumber !== undefined) {
        location = `page ${metadata.pageNumber}`;
      } else if (metadata.startIndex !== undefined) {
        location = `char ${metadata.startIndex}`;
      }

      // Extract source from metadata (common field names)
      const source =
        (metadata.source as string) ??
        (metadata.filePath as string) ??
        (metadata.file as string) ??
        (metadata.url as string);

      return {
        index: index + 1, // 1-indexed for human readability
        chunkId: result.chunk.id,
        documentId: result.chunk.documentId,
        source,
        location,
        score: result.score,
        section: metadata.section,
      };
    });
  }
}
