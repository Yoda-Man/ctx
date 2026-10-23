/**
 * Recursive Text Chunker
 *
 * Splits documents using a hierarchy of separators, trying to preserve
 * natural document structure (paragraphs, lines, sentences).
 */

import type { Chunk, ChunkingOptions, Document } from './types.js';
import { BaseChunker } from './base-chunker.js';
import { CHARS_PER_TOKEN } from './token-counter.js';

/**
 * Default separator hierarchy for recursive chunking.
 *
 * Ordered from largest to smallest semantic unit:
 * 1. Double newline (paragraphs)
 * 2. Single newline (lines)
 * 3. Period + space (sentences)
 * 4. Space (words)
 */
const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' '];

/**
 * Recursive chunking strategy.
 *
 * Splits text using a hierarchy of separators, preserving natural
 * document structure when possible. Falls back to smaller separators
 * when chunks are too large.
 *
 * Best for:
 * - Prose and natural language documents
 * - Documents with clear paragraph/section structure
 * - When semantic coherence matters more than exact sizes
 *
 * @example
 * ```typescript
 * const chunker = new RecursiveChunker();
 *
 * const chunks = await chunker.chunk(document, {
 *   chunkSize: 512,
 *   chunkOverlap: 50
 * });
 * ```
 */
export class RecursiveChunker extends BaseChunker {
  readonly name = 'RecursiveChunker';

  /** Separator hierarchy (largest to smallest) */
  private readonly separators: string[];

  constructor(separators: string[] = DEFAULT_SEPARATORS) {
    super();
    this.separators = separators;
  }

  /**
   * Split document using recursive separator hierarchy.
   */
  protected async _chunk(
    document: Document,
    options: Required<ChunkingOptions>
  ): Promise<Chunk[]> {
    const { chunkSize, chunkOverlap, sizeUnit } = options;
    const text = document.content;

    // Convert to character counts
    const maxChars =
      sizeUnit === 'tokens' ? chunkSize * CHARS_PER_TOKEN : chunkSize;
    const overlapChars =
      sizeUnit === 'tokens' ? chunkOverlap * CHARS_PER_TOKEN : chunkOverlap;

    // Recursively split the text
    const segments = this.splitRecursively(text, maxChars, 0);

    // Merge small segments and apply overlap
    const mergedSegments = this.mergeSegments(segments, maxChars, overlapChars);

    // Convert segments to chunks with metadata
    const chunks: Chunk[] = [];
    let currentIndex = 0;
    let chunkIndex = 0;

    for (const content of mergedSegments) {
      if (content.trim().length === 0) {
        continue;
      }

      const startIndex = text.indexOf(content, currentIndex);
      const endIndex = startIndex + content.length;

      chunks.push(
        this.createChunk(content, document, chunkIndex, startIndex, endIndex, options)
      );
      chunkIndex++;

      // Update search position (accounting for overlap)
      currentIndex = Math.max(currentIndex, startIndex + 1);
    }

    return chunks;
  }

  /**
   * Recursively split text using separator hierarchy.
   */
  private splitRecursively(
    text: string,
    maxChars: number,
    separatorIndex: number
  ): string[] {
    // Base case: text fits or no more separators
    if (text.length <= maxChars || separatorIndex >= this.separators.length) {
      return text.length > 0 ? [text] : [];
    }

    const separator = this.separators[separatorIndex];
    if (!separator) {
      // No separator at this index, return text as-is
      return text.length > 0 ? [text] : [];
    }

    const parts = this.splitWithSeparator(text, separator);

    const result: string[] = [];

    for (const part of parts) {
      if (part.length <= maxChars) {
        // Part fits, keep it
        result.push(part);
      } else {
        // Part too large, split with next separator
        const subParts = this.splitRecursively(
          part,
          maxChars,
          separatorIndex + 1
        );
        result.push(...subParts);
      }
    }

    return result;
  }

  /**
   * Split text by separator, keeping the separator at the end of each segment.
   */
  private splitWithSeparator(text: string, separator: string): string[] {
    if (!text.includes(separator)) {
      return [text];
    }

    const parts = text.split(separator);
    const result: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;

      // Add separator back (except for last segment)
      const segment = i < parts.length - 1 ? part + separator : part;

      if (segment.length > 0) {
        result.push(segment);
      }
    }

    return result;
  }

  /**
   * Merge small segments together and apply overlap.
   */
  private mergeSegments(
    segments: string[],
    maxChars: number,
    overlapChars: number
  ): string[] {
    if (segments.length === 0) return [];

    const result: string[] = [];
    let current = '';
    let previousEnd = '';

    for (const segment of segments) {
      const wouldBe = current + segment;

      if (wouldBe.length <= maxChars) {
        // Segment fits, add to current
        current = wouldBe;
      } else {
        // Would exceed max, finalize current chunk
        if (current.length > 0) {
          result.push(current);
          // Save end of current chunk for overlap
          previousEnd = current.slice(-overlapChars);
        }

        // Start new chunk with overlap from previous
        if (segment.length <= maxChars) {
          current = previousEnd + segment;
          // Trim if overlap made it too long
          if (current.length > maxChars) {
            current = segment;
          }
        } else {
          // Segment itself exceeds max, add as-is (will be large)
          current = previousEnd + segment;
          if (current.length > maxChars) {
            current = segment;
          }
        }
      }
    }

    // Don't forget the last chunk
    if (current.length > 0) {
      result.push(current);
    }

    return result;
  }
}
