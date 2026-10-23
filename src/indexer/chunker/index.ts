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
 * import { chunkFile, chunkFiles } from './chunker';
 * import { scanDirectory } from './scanner';
 *
 * const { files } = await scanDirectory('./my-project');
 * const chunks = await chunkFiles(files);
 * // chunks ready for embedding
 * ```
 */

// Main chunker functions
export {
  chunkFile,
  
  // Structured result functions (Ticket #50)
  
  chunkFilesWithResult,
  type ChunkerConfig,
} from './chunker.js';

// Types
export type {
  
  
  
  
  
  
  // Structured result types (Ticket #50)
  
  
  
} from './types.js';

// Configuration
export {
  
  
  
  
  estimateTokens,
  
} from './config.js';

// Extractors (for advanced use)
export {
  extractCodeSegments,
  extractMarkdownSegments,
  isLanguageSupported,
  isMarkdown,
} from './extractors/index.js';
