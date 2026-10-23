/**
 * Context Assembly Types
 *
 * Core interfaces for the context assembly stage of the RAG pipeline.
 * Context assembly takes reranked chunks and formats them for LLM consumption,
 * handling ordering, deduplication, and token budget management.
 */

import type { Chunk } from '../vector-store/types.js';
import type { RerankerResult } from '../reranker/types.js';

// ============================================================================
// Ordering Strategy Types
// ============================================================================

/**
 * Strategy for ordering chunks in assembled context.
 *
 * LLMs exhibit "lost in the middle" phenomenon where they pay
 * more attention to content at the beginning and end of context.
 *
 * - 'relevance': Order by score descending (default)
 * - 'sandwich': Most relevant at start and end (mitigates lost-in-middle)
 * - 'chronological': Order by document/chunk position (if available)
 */
export type OrderingStrategy = 'relevance' | 'sandwich' | 'chronological';

// ============================================================================
// Source Attribution Types
// ============================================================================

/**
 * Attribution information for a source chunk.
 *
 * Provides traceability from assembled context back to original documents.
 */
export interface SourceAttribution {
  /** Sequential index in the assembled context (1-indexed) */
  index: number;
  /** Original chunk ID */
  chunkId: string;
  /** Source document ID (if available) */
  documentId?: string;
  /** File path or URL (if available in metadata) */
  source?: string;
  /** Line or page number (if available) */
  location?: string;
  /** Relevance score (0-1) */
  score: number;
  /** Section or heading (if available) */
  section?: string;
}

// ============================================================================
// Token Budget Types
// ============================================================================

/**
 * Configuration for token budget management.
 *
 * Ensures assembled context fits within LLM context window limits.
 */
export interface TokenBudgetConfig {
  /**
   * Maximum tokens allowed for the assembled context.
   * If not set, uses contextWindowSize * budgetPercentage.
   */
  maxTokens?: number;

  /**
   * Total context window size of the target LLM.
   * Used with budgetPercentage to calculate maxTokens.
   * Default: 8192 (GPT-3.5 default)
   */
  contextWindowSize?: number;

  /**
   * Percentage of context window to use for retrieved context.
   * Leaves room for system prompt, user query, and response.
   * Default: 0.5 (50%)
   */
  budgetPercentage?: number;

  /**
   * How to handle chunks that exceed the budget.
   * - 'truncate': Include partial chunk content
   * - 'drop': Exclude the chunk entirely
   * Default: 'drop'
   */
  overflowStrategy?: 'truncate' | 'drop';
}

// ============================================================================
// Deduplication Types
// ============================================================================

/**
 * Configuration for chunk deduplication.
 *
 * Removes near-duplicate chunks to maximize information density.
 */
export interface DeduplicationConfig {
  /**
   * Enable deduplication.
   * Default: true
   */
  enabled?: boolean;

  /**
   * Similarity threshold for considering chunks as duplicates.
   * Uses Jaccard similarity on word sets.
   * 0.0 = never dedupe, 1.0 = only exact matches
   * Default: 0.8
   */
  similarityThreshold?: number;

  /**
   * When duplicates found, keep the one with higher score.
   * If false, keeps the first encountered.
   * Default: true
   */
  keepHighestScore?: boolean;
}

// ============================================================================
// Assembly Result Types
// ============================================================================

/**
 * Result of context assembly operation.
 *
 * Contains the formatted context string plus metadata for debugging
 * and citation generation.
 */
export interface AssembledContext {
  /** The formatted context string ready for LLM consumption */
  content: string;

  /**
   * Token count estimate.
   * Uses simple heuristic: ~4 characters per token.
   */
  estimatedTokens: number;

  /** Number of chunks included in the assembled context */
  chunkCount: number;

  /** Number of chunks removed by deduplication */
  deduplicatedCount: number;

  /** Number of chunks dropped due to token budget */
  droppedCount: number;

  /** Source attributions for all included chunks */
  sources: SourceAttribution[];

  /**
   * The chunks in their final order (after ordering and filtering).
   * Useful for debugging or further processing.
   */
  chunks: Chunk[];
}

// ============================================================================
// Assembler Configuration
// ============================================================================

/**
 * Configuration for context assemblers.
 */
export interface AssemblerConfig {
  /** Name for this assembler instance */
  name?: string;

  /**
   * Ordering strategy for chunks.
   * Default: 'relevance'
   */
  ordering?: OrderingStrategy;

  /**
   * For 'sandwich' ordering: how many top chunks at the start.
   * Remaining high-scoring chunks go at the end.
   * Default: half of included chunks
   */
  sandwichStartCount?: number;

  /** Token budget configuration */
  tokenBudget?: TokenBudgetConfig;

  /** Deduplication configuration */
  deduplication?: DeduplicationConfig;

  /**
   * Include source attributions in formatted output.
   * Default: true
   */
  includeSourceAttribution?: boolean;

  /**
   * Include relevance scores in formatted output.
   * Default: false
   */
  includeScores?: boolean;
}

// ============================================================================
// XML Assembler Configuration
// ============================================================================

/**
 * Configuration specific to XML format assembler.
 *
 * Outputs: `<source id="1" file="..." line="...">content</source>`
 */
export interface XMLAssemblerConfig extends AssemblerConfig {
  /**
   * Root element tag name.
   * Default: 'sources'
   */
  rootTag?: string;

  /**
   * Individual source element tag name.
   * Default: 'source'
   */
  sourceTag?: string;

  /**
   * Include file path attribute.
   * Default: true
   */
  includeFilePath?: boolean;

  /**
   * Include line/page number attribute.
   * Default: true
   */
  includeLocation?: boolean;

  /**
   * Pretty print with indentation.
   * Default: true
   */
  prettyPrint?: boolean;
}

// ============================================================================
// Markdown Assembler Configuration
// ============================================================================

/**
 * Configuration specific to Markdown format assembler.
 *
 * Outputs: `[1] content... (source: file:line)`
 */
export interface MarkdownAssemblerConfig extends AssemblerConfig {
  /**
   * Format for source citations.
   * - 'inline': `[1] content (source: file.md:10)`
   * - 'footnote': `content [1]` with footnotes at end
   * - 'header': `### Source 1: file.md\ncontent`
   * Default: 'inline'
   */
  citationStyle?: 'inline' | 'footnote' | 'header';

  /**
   * Separator between chunks.
   * Default: '\n\n---\n\n'
   */
  chunkSeparator?: string;

  /**
   * Include section headers if available.
   * Default: true
   */
  includeSectionHeaders?: boolean;
}

// ============================================================================
// Assembler Interface
// ============================================================================

/**
 * Options for a single assembly operation.
 *
 * Can override config defaults for specific queries.
 */
export interface AssemblyOptions {
  /** Maximum number of chunks to include (before deduplication) */
  topK?: number;

  /** Override ordering strategy */
  ordering?: OrderingStrategy;

  /** Override token budget */
  maxTokens?: number;

  /** Override deduplication threshold */
  deduplicationThreshold?: number;

  /** Additional context to prepend (e.g., system instructions) */
  preamble?: string;

  /** Additional context to append (e.g., query recap) */
  postamble?: string;
}

/**
 * Interface for all context assemblers.
 *
 * Context assemblers take reranked results and format them
 * into a string suitable for LLM consumption.
 *
 * @example
 * ```typescript
 * const assembler: ContextAssembler = new XMLAssembler({
 *   ordering: 'sandwich',
 *   tokenBudget: { maxTokens: 4000 },
 * });
 *
 * const assembled = await assembler.assemble(rerankedResults, {
 *   topK: 10,
 *   preamble: 'Use the following sources to answer:',
 * });
 *
 * console.log(assembled.content);
 * // <sources>
 * //   <source id="1" file="docs/auth.md">...</source>
 * //   ...
 * // </sources>
 * ```
 */
export interface ContextAssembler {
  /** Human-readable name of this assembler */
  readonly name: string;

  /**
   * Assemble reranked results into formatted context.
   *
   * @param results - Reranked results from the reranking stage
   * @param options - Assembly options (can override config)
   * @returns Assembled context with formatted string and metadata
   */
  assemble(
    results: RerankerResult[],
    options?: AssemblyOptions
  ): Promise<AssembledContext>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for assembly failures.
 */
export type AssemblyErrorCode =
  | 'INVALID_INPUT'
  | 'TOKEN_BUDGET_EXCEEDED'
  | 'FORMATTING_FAILED'
  | 'CONFIG_ERROR'
  | 'DEDUPLICATION_FAILED';

/**
 * Details about an assembly error.
 */
export interface AssemblyErrorDetails {
  /** Machine-readable error code */
  code: AssemblyErrorCode;
  /** Name of the assembler that failed */
  assemblerName: string;
  /** Underlying cause, if any */
  cause?: Error;
}
