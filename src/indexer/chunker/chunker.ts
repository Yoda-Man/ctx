/**
 * Chunker
 *
 * Main orchestration for the document chunking pipeline.
 * Routes files to appropriate extractors and applies chunking strategies.
 *
 * Architecture:
 * 1. FileInfo → Read content
 * 2. Extract segments (code, docs) based on file type
 * 3. Chunk segments with appropriate strategy:
 *    - Code/config → RecursiveChunker (syntax-aware character splitting)
 *    - Docs → SemanticChunker (topic-aware via embedding similarity)
 * 4. Produce ChunkResult[] with metadata
 *
 * Dual-Chunker Strategy:
 * - Code has EXPLICIT structure (AST, braces, indentation)
 * - Docs have IMPLICIT structure (topics, concepts)
 * - Using the right chunker for each produces more coherent chunks
 */

import { randomUUID } from 'node:crypto';
import {
  RecursiveChunker,
  type Chunk,
  type Document,
  SemanticChunker,
  type EmbeddingProvider,
} from '../../sdk/rag/index.js';
import { errorMessage } from '../../utils/error.js';

import type { FileInfo } from '../types.js';
import { isConvertedDocument, readAsText } from '../documents.js';
import type {
  ChunkResult,
  ChunkOptions,
  ExtractedSegment,
  FileChunkResult,
  BatchChunkResult,
} from './types.js';
import {
  extractCodeSegments,
  extractMarkdownSegments,
  prepareLanguage,
  wholeFile,
} from './extractors/index.js';
import {
  MAX_FILE_SIZE,
  getChunkConfig,
  estimateTokens,
} from './config.js';

/**
 * Configuration for the chunker.
 */
export interface ChunkerConfig {
  /**
   * Embedding provider for SemanticChunker.
   *
   * When provided, 'docs' segments use SemanticChunker (topic-aware splitting)
   * instead of RecursiveChunker. This produces more cohesive chunks for prose.
   *
   * Create with: `createEmbeddingProvider(config.embedding)`
   */
  embeddingProvider?: EmbeddingProvider;
}

// ============================================================================
// Structured Result Functions (Ticket #50)
// ============================================================================

/**
 * Chunk a single file with structured result reporting.
 *
 * Unlike chunkFile(), this returns a FileChunkResult with:
 * - Explicit success/failure indication
 * - Reason why file was skipped (if applicable)
 * - Warnings collected during processing
 *
 * Use this when you need to distinguish between different failure modes
 * or aggregate error statistics.
 *
 * @param fileInfo - File metadata from discovery
 * @param config - Optional chunker configuration
 * @param options - Callbacks for progress (onChunk only; errors reported in result)
 * @returns FileChunkResult with success, chunks, and error details
 */
async function chunkFileWithResult(
  fileInfo: FileInfo,
  config: ChunkerConfig = {},
  options: Pick<ChunkOptions, 'onChunk'> = {}
): Promise<FileChunkResult> {
  const warnings: string[] = [];

  // Check file size limit. Word and PDF files are mostly images and layout, so
  // for them the limit applies to the converted text instead.
  const converted = isConvertedDocument(fileInfo.path);
  if (!converted && fileInfo.size > MAX_FILE_SIZE) {
    return tooLarge(fileInfo, fileInfo.size, warnings);
  }

  // Read file content (.docx and .pdf are converted to Markdown)
  let content: string;
  try {
    content = await readAsText(fileInfo.path);
  } catch (error) {
    return {
      filePath: fileInfo.relativePath,
      success: false,
      chunks: [],
      skipReason: 'read_error',
      error: (error as Error).message,
      warnings,
    };
  }

  if (converted && Buffer.byteLength(content) > MAX_FILE_SIZE) {
    return tooLarge(fileInfo, Buffer.byteLength(content), warnings);
  }

  // Empty files are success (valid file, just no content)
  if (!content.trim()) {
    if (converted) {
      // A scanned PDF is images only; say so rather than skip it silently.
      warnings.push('No text found (a scanned document needs OCR before it can be indexed)');
    }
    return {
      filePath: fileInfo.relativePath,
      success: true,
      chunks: [],
      skipReason: 'empty',
      warnings,
    };
  }

  // Extract segments based on file type (a WebAssembly parser loads first, once)
  const parserWarning = await prepareLanguage(fileInfo.language);
  if (parserWarning) warnings.push(parserWarning);
  const { segments, warning: extractWarning } = extractSegments(content, fileInfo);
  if (extractWarning) warnings.push(extractWarning);

  // Warn if no segments were extracted from a non-empty file
  if (segments.length === 0) {
    warnings.push('No extractable segments found');
  }

  // Chunk each segment
  const chunks: ChunkResult[] = [];
  let chunkIndex = 0;

  for (const segment of segments) {
    // A short segment (`x = 1`, `package main`) is still a chunk: every line is indexed
    if (!segment.content.trim()) continue;

    // Get chunk configuration for this content type
    const chunkConfig = getChunkConfig(segment.contentType);

    // Estimate token count
    const tokenCount = estimateTokens(segment.content);

    let segmentChunks: Chunk[];

    if (tokenCount <= chunkConfig.chunkSize) {
      // Small enough - keep as single chunk
      segmentChunks = [{
        id: randomUUID(),
        content: segment.content,
        metadata: {},
      }];
    } else {
      const document: Document = {
        id: randomUUID(),
        content: segment.content,
        metadata: {},
        source: fileInfo.relativePath,
      };
      const chunkOptions = {
        chunkSize: chunkConfig.chunkSize,
        chunkOverlap: chunkConfig.chunkOverlap,
        sizeUnit: 'tokens' as const,
      };

      let semanticChunks: Chunk[] | undefined;
      if (segment.contentType === 'docs' && config.embeddingProvider) {
        // Docs content with embedding provider → split where the topic changes
        try {
          semanticChunks = await new SemanticChunker({
            embeddingProvider: config.embeddingProvider,
            similarityThreshold: 0.5,
            minChunkSize: 100,
            maxChunkSize: chunkConfig.chunkSize,
          }).chunk(document, chunkOptions);
        } catch (error) {
          // One failed embedding call used to abort the whole index
          warnings.push(`Semantic chunking failed at line ${segment.startLine} (${errorMessage(error)}); split by size instead`);
        }
      }

      // Code/config content, no embedding provider, or a failed semantic split
      segmentChunks = semanticChunks ?? await new RecursiveChunker().chunk(document, chunkOptions);
    }

    // Map to ChunkResult with full metadata. Chunks come in order and overlap
    // by at most chunkOverlap, so each is searched for from just before the
    // previous one's end: a repeated block gets its own lines, not the first copy's.
    const overlapChars = chunkConfig.chunkOverlap * 4 * 2; // ~4 chars a token, doubled for slack
    let searchFrom = 0;
    for (const chunk of segmentChunks) {
      const { startLine, endLine, offset } = computeLineNumbers(
        segment.content,
        chunk.content,
        segment.startLine,
        searchFrom
      );
      if (offset !== -1) searchFrom = Math.max(offset + 1, offset + chunk.content.length - overlapChars);

      const result: ChunkResult = {
        id: chunk.id,
        content: chunk.content,
        file_path: fileInfo.relativePath,
        file_type: fileInfo.type,
        content_type: segment.contentType,
        language: fileInfo.language,
        start_line: startLine,
        end_line: endLine,
        metadata: {
          originalSize: fileInfo.size,
          chunkIndex,
          totalChunks: 0,
          symbolName: segment.metadata.symbolName,
          symbolType: segment.metadata.symbolType,
          parentSymbol: segment.metadata.parentSymbol,
          sectionHeader: segment.metadata.sectionHeader,
        },
      };

      chunks.push(result);
      options.onChunk?.(result);
      chunkIndex++;
    }
  }

  // Update totalChunks in all chunk metadata
  for (const chunk of chunks) {
    chunk.metadata.totalChunks = chunks.length;
  }

  return {
    filePath: fileInfo.relativePath,
    success: true,
    chunks,
    warnings,
  };
}

/**
 * Yield to the event loop between files.
 * Keeps the REPL/TUI responsive during long chunking operations.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Yield every N files to balance throughput with responsiveness. */
const CHUNKING_YIELD_INTERVAL = 5;

/**
 * Chunk multiple files with aggregated result reporting.
 *
 * Returns a BatchChunkResult with:
 * - Per-file results (success/failure for each)
 * - Aggregate counts (successCount, failureCount, totalChunks)
 * - All warnings and errors collected
 *
 * @param files - Array of file info objects
 * @param config - Optional chunker configuration
 * @param options - Callbacks for progress (onChunk only)
 * @returns BatchChunkResult with aggregated statistics
 */
export async function chunkFilesWithResult(
  files: FileInfo[],
  config: ChunkerConfig = {},
  options: Pick<ChunkOptions, 'onChunk'> = {}
): Promise<BatchChunkResult> {
  const fileResults: FileChunkResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  const allWarnings: string[] = [];
  const allErrors: string[] = [];

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]!;
    const result = await chunkFileWithResult(file, config, options);
    fileResults.push(result);

    if (result.success) {
      successCount++;
    } else {
      failureCount++;
      if (result.error) {
        allErrors.push(`${result.filePath}: ${result.error}`);
      }
    }

    // Prefix warnings with file path for context
    for (const warning of result.warnings) {
      allWarnings.push(`${result.filePath}: ${warning}`);
    }

    // Yield to event loop periodically to keep TUI/REPL responsive
    if ((fi + 1) % CHUNKING_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }

  return {
    files: fileResults,
    successCount,
    failureCount,
    totalChunks: fileResults.reduce((sum, r) => sum + r.chunks.length, 0),
    warnings: allWarnings,
    errors: allErrors,
  };
}

// ============================================================================
// Legacy Functions (Backward Compatible)
// ============================================================================

/**
 * Chunk a single file into segments ready for embedding.
 *
 * Delegates to chunkFileWithResult() and reports problems through callbacks
 * instead of a result. The pipeline uses chunkFilesWithResult(), which
 * returns each file's success, skip reason and warnings.
 *
 * @param fileInfo - File metadata from discovery
 * @param config - Optional chunker configuration
 * @param options - Callbacks for progress/errors
 * @returns Array of chunks ready for embedding
 */
export async function chunkFile(
  fileInfo: FileInfo,
  config: ChunkerConfig = {},
  options: ChunkOptions = {}
): Promise<ChunkResult[]> {
  const result = await chunkFileWithResult(fileInfo, config, { onChunk: options.onChunk });

  // Fire legacy callbacks based on result
  if (!result.success && result.error) {
    options.onError?.(new Error(result.error), result.filePath);
  }

  // Convert skipReason to warning for large files (legacy behavior)
  if (result.skipReason === 'too_large' && result.error) {
    options.onWarning?.(result.error, result.filePath);
  }

  // Forward any warnings
  for (const warning of result.warnings) {
    options.onWarning?.(warning, result.filePath);
  }

  return result.chunks;
}

/**
 * Result of segment extraction with error handling.
 */
interface ExtractionResultWithWarning {
  segments: ExtractedSegment[];
  /** Set when parsing failed and the file was kept whole instead */
  warning?: string;
}

/**
 * Extract segments from file content based on type.
 *
 * Wraps extractor calls in try-catch to capture parse errors gracefully
 * instead of crashing the entire chunking pipeline.
 */
function extractSegments(content: string, fileInfo: FileInfo): ExtractionResultWithWarning {
  // Config files → treat as single segment (no parsing, can't fail)
  if (fileInfo.type === 'config') {
    return { segments: [wholeFile(content, 'config', {})] };
  }

  try {
    // Markdown, and Word and PDF files (read as Markdown) → split by section
    if (fileInfo.language === 'markdown') {
      return { segments: extractMarkdownSegments(content).segments };
    }

    // Code files (supported or fallback) → use code extractor
    return { segments: extractCodeSegments(content, fileInfo.language, fileInfo.extension).segments };
  } catch (error) {
    // Parsing failed: keep the whole file, split by size, so it is still searchable
    return {
      segments: [wholeFile(content, fileInfo.language === 'markdown' ? 'docs' : 'code')],
      warning: `Parsing failed (${(error as Error).message}), so the file is split by size`,
    };
  }
}

/**
 * Compute line numbers for a chunk within a segment.
 */
function computeLineNumbers(
  segmentContent: string,
  chunkContent: string,
  segmentStartLine: number,
  searchFrom: number
): { startLine: number; endLine: number; offset: number } {
  // Find where this chunk starts within the segment
  let chunkStartOffset = segmentContent.indexOf(chunkContent, searchFrom);
  if (chunkStartOffset === -1) chunkStartOffset = segmentContent.indexOf(chunkContent);

  if (chunkStartOffset === -1) {
    // Chunk not found (shouldn't happen) - use segment boundaries
    const chunkLines = chunkContent.split('\n').length;
    return {
      startLine: segmentStartLine,
      endLine: segmentStartLine + chunkLines - 1,
      offset: -1,
    };
  }

  // Count lines before the chunk start
  const linesBeforeChunk = segmentContent.slice(0, chunkStartOffset).split('\n').length - 1;
  const startLine = segmentStartLine + linesBeforeChunk;

  // Count lines in the chunk
  const chunkLines = chunkContent.split('\n').length;
  const endLine = startLine + chunkLines - 1;

  return { startLine, endLine, offset: chunkStartOffset };
}

function tooLarge(fileInfo: FileInfo, size: number, warnings: string[]): FileChunkResult {
  return {
    filePath: fileInfo.relativePath,
    success: false,
    chunks: [],
    skipReason: 'too_large',
    error: `File too large (${formatSize(size)} > ${formatSize(MAX_FILE_SIZE)})`,
    warnings,
  };
}

/**
 * Format file size in human-readable form.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
