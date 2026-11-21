/**
 * Chunker Module
 *
 * Document chunking pipeline with dual-track extraction:
 * - Code files → AST-aware extraction (functions, classes, docstrings)
 * - Markdown files → Prose/code block separation
 * - Config files → Direct chunking
 *
 * Usage:
 * ```typescript
 * import { chunkFilesWithResult } from './chunker';
 * import { scanDirectory } from './scanner';
 *
 * const { files } = await scanDirectory('./my-project');
 * const { files: results } = await chunkFilesWithResult(files);
 * // each result's chunks are ready for embedding
 * ```
 */

// Main chunker functions
export {
  chunkFile,
  // Structured result functions (Ticket #50)
  chunkFilesWithResult,
  type ChunkerConfig,
} from './chunker.js';

// Configuration
export { estimateTokens } from './config.js';

// Extractors (for advanced use)
export {
  extractCodeSegments,
  extractMarkdownSegments,
} from './extractors/index.js';
