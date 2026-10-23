/**
 * Base Text Chunker
 *
 * Abstract class providing common functionality for all text chunkers.
 */

import { createHash } from 'node:crypto';
import type {
  Chunk,
  ChunkMetadata,
  ChunkingOptions,
  ChunkingStrategy,
  Document,
} from './types.js';
import { DEFAULT_CHUNKING_OPTIONS } from './types.js';
import { ChunkerError } from './errors.js';
import { measureSize } from './token-counter.js';

/** Minimum allowed chunk size in tokens */
const MIN_CHUNK_SIZE = 10;

/**
 * Abstract base class for text chunkers.
 *
 * Provides:
 * - Options validation and merging
 * - Chunk ID generation (deterministic)
 * - Metadata handling
 * - Context header generation
 *
 * Subclasses must implement:
 * - `_chunk()` - Strategy-specific splitting logic
 *
 * @example
 * ```typescript
 * class MyChunker extends BaseChunker {
 *   readonly name = 'MyChunker';
 *
 *   protected async _chunk(
 *     document: Document,
 *     options: Required<ChunkingOptions>
 *   ): Promise<Chunk[]> {
 *     // Implement splitting logic
 *   }
 * }
 * ```
 */
export abstract class BaseChunker implements ChunkingStrategy {
  /** Human-readable name of this chunker */
  abstract readonly name: string;

  /**
   * Split a document into chunks.
   *
   * Validates inputs, merges options with defaults, then delegates
   * to the subclass implementation.
   */
  chunk = async (
    document: Document,
    options?: ChunkingOptions
  ): Promise<Chunk[]> => {
    // Merge with defaults
    const opts = this.mergeOptions(options);

    // Validate inputs
    this.validateDocument(document);
    this.validateOptions(opts, document.id);

    // Delegate to subclass
    const chunks = await this._chunk(document, opts);

    // Post-process: add context headers if requested
    if (opts.addContextHeaders) {
      return chunks.map((chunk) => this.addContextHeader(chunk, document));
    }

    return chunks;
  };

  /**
   * Implement the chunking strategy.
   *
   * Subclasses must implement this method with their specific splitting logic.
   *
   * @param document - The document to chunk
   * @param options - Validated and merged options (all fields present)
   * @returns Array of chunks with position metadata
   */
  protected abstract _chunk(
    document: Document,
    options: Required<ChunkingOptions>
  ): Promise<Chunk[]>;

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Merge user options with defaults.
   */
  protected mergeOptions = (
    options?: ChunkingOptions
  ): Required<ChunkingOptions> => {
    return {
      ...DEFAULT_CHUNKING_OPTIONS,
      ...options,
    };
  };

  /**
   * Validate document before chunking.
   */
  protected validateDocument = (document: Document): void => {
    if (!document.content || document.content.trim().length === 0) {
      throw ChunkerError.emptyDocument(this.name, document.id);
    }
  };

  /**
   * Validate chunking options.
   */
  protected validateOptions = (
    options: Required<ChunkingOptions>,
    documentId?: string
  ): void => {
    if (options.chunkSize < MIN_CHUNK_SIZE) {
      throw ChunkerError.chunkTooSmall(
        this.name,
        MIN_CHUNK_SIZE,
        options.chunkSize,
        documentId
      );
    }

    if (options.chunkOverlap < 0) {
      throw ChunkerError.invalidOptions(
        this.name,
        'chunkOverlap cannot be negative',
        documentId
      );
    }

    if (options.chunkOverlap >= options.chunkSize) {
      throw ChunkerError.invalidOptions(
        this.name,
        'chunkOverlap must be less than chunkSize',
        documentId
      );
    }
  };

  /**
   * Generate a deterministic chunk ID.
   *
   * Uses SHA-256 hash of document ID + chunk index for reproducibility.
   */
  protected generateChunkId = (documentId: string, index: number): string => {
    const hash = createHash('sha256');
    hash.update(documentId);
    hash.update(`:chunk:${index}`);
    return hash.digest('hex').slice(0, 16);
  };

  /**
   * Create a chunk with metadata.
   */
  protected createChunk = (
    content: string,
    document: Document,
    index: number,
    startIndex: number,
    endIndex: number,
    options: Required<ChunkingOptions>
  ): Chunk => {
    const metadata: ChunkMetadata = {
      startIndex,
      endIndex,
    };

    // Preserve document metadata if requested
    if (options.preserveMetadata && document.metadata) {
      // Copy relevant metadata (excluding internal fields)
      if (document.metadata.title) {
        metadata.section = document.metadata.title;
      }
    }

    return {
      id: this.generateChunkId(document.id, index),
      content,
      metadata,
      documentId: document.id,
    };
  };

  /**
   * Add context header to chunk content.
   *
   * Prepends document title and section info to help retrieval
   * understand the chunk's context.
   */
  protected addContextHeader = (chunk: Chunk, document: Document): Chunk => {
    const parts: string[] = [];

    // Add document title if available
    if (document.metadata?.title) {
      parts.push(`Document: ${document.metadata.title}`);
    }

    // Add section if available
    if (
      chunk.metadata.section &&
      chunk.metadata.section !== document.metadata?.title
    ) {
      parts.push(`Section: ${chunk.metadata.section}`);
    }

    // If no context to add, return unchanged
    if (parts.length === 0) {
      return chunk;
    }

    // Prepend header to content
    const header = parts.join('\n') + '\n\n';
    return {
      ...chunk,
      content: header + chunk.content,
    };
  };

  /**
   * Measure the size of text in the configured unit.
   */
  protected measureText = (
    text: string,
    options: Required<ChunkingOptions>
  ): number => {
    return measureSize(text, options.sizeUnit);
  };
}
