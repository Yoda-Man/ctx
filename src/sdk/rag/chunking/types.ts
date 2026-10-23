/**
 * Text Chunking Types
 *
 * Core interfaces for the RAG text chunking system.
 * All chunkers must implement the ChunkingStrategy interface.
 */

import type { Document } from '../loaders/types.js';
import type { Chunk } from '../vector-store/types.js';

// ============================================================================
// Chunking Options
// ============================================================================

/**
 * Size unit for measuring chunks.
 *
 * - tokens: Count by estimated tokens (~4 chars = 1 token)
 * - characters: Count by raw characters
 */
export type SizeUnit = 'tokens' | 'characters';

/**
 * Options for chunking operations.
 */
export interface ChunkingOptions {
  /** Target size for each chunk (default: 512) */
  chunkSize?: number;
  /** Overlap between consecutive chunks (default: 50) */
  chunkOverlap?: number;
  /** Unit for size measurements (default: 'tokens') */
  sizeUnit?: SizeUnit;
  /** Preserve document metadata in chunks (default: true) */
  preserveMetadata?: boolean;
  /** Prepend contextual headers (title, section) to chunk content (default: false) */
  addContextHeaders?: boolean;
}

/**
 * Default chunking options.
 */
export const DEFAULT_CHUNKING_OPTIONS: Required<ChunkingOptions> = {
  chunkSize: 512,
  chunkOverlap: 50,
  sizeUnit: 'tokens',
  preserveMetadata: true,
  addContextHeaders: false,
};

// ============================================================================
// Chunking Strategy Interface
// ============================================================================

/**
 * Interface for text chunking strategies.
 *
 * Chunkers are responsible for splitting documents into smaller chunks
 * suitable for embedding and retrieval.
 *
 * @example
 * ```typescript
 * const chunker: ChunkingStrategy = new RecursiveChunker();
 *
 * const chunks = await chunker.chunk(document, {
 *   chunkSize: 512,
 *   chunkOverlap: 50,
 *   sizeUnit: 'tokens'
 * });
 * ```
 */
export interface ChunkingStrategy {
  /** Human-readable name of this strategy */
  readonly name: string;

  /**
   * Split a document into chunks.
   *
   * @param document - The document to chunk
   * @param options - Chunking options (size, overlap, etc.)
   * @returns Array of chunks with position metadata
   * @throws {ChunkerError} If chunking fails
   */
  chunk(document: Document, options?: ChunkingOptions): Promise<Chunk[]>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for chunker failures.
 */
export type ChunkerErrorCode =
  | 'EMPTY_DOCUMENT'
  | 'INVALID_OPTIONS'
  | 'CHUNK_TOO_SMALL'
  | 'CHUNKER_ERROR'
  | 'CONFIG_ERROR'
  | 'PROVIDER_REQUIRED'
  | 'LLM_PARSE_ERROR';

/**
 * Details about a chunker error.
 */
export interface ChunkerErrorDetails {
  /** Machine-readable error code */
  code: ChunkerErrorCode;
  /** Name of the chunker that failed */
  chunkerName: string;
  /** Document ID that was being chunked */
  documentId?: string;
  /** Underlying cause, if any */
  cause?: Error;
}

// Re-export types that chunkers produce/consume
export type { Document, DocumentMetadata } from '../loaders/types.js';
export type { Chunk, ChunkMetadata } from '../vector-store/types.js';
