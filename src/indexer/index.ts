/**
 * File Indexer Module
 *
 * This module provides file discovery capabilities for the Context Expert CLI.
 * It scans project directories, respects gitignore patterns, and returns
 * metadata about discovered files.
 *
 * @example
 * ```ts
 * import { scanDirectory, DEFAULT_SUPPORTED_EXTENSIONS } from './indexer';
 *
 * const result = await scanDirectory('/path/to/project', {
 *   maxDepth: 10,
 *   onFile: (file) => console.log(`Found: ${file.relativePath}`),
 * });
 *
 * console.log(`Discovered ${result.stats.totalFiles} files`);
 * console.log(`Languages: ${Object.keys(result.stats.byLanguage).join(', ')}`);
 * ```
 */

// Main scanner functions
;

// Ignore pattern utilities
;

// Types and constants
export {
  // Types
  
  
  
  
  
  

  // Constants
  
  
  
  

  // Utility functions
  
  
} from './types.js';

// Chunker module
export {
  // Main functions
  
  
  

  // Types
  
  
  
  
  
  

  // Configuration
  
  
  
  
  
  

  // Extractors (for advanced use)
  
  
  
  
} from './chunker/index.js';

// Embedder module
export {
  // Provider factory
  createEmbeddingProvider,
  

  // Embedder orchestration
  
  
  

  // Types
  
  
  
  
  
  type EmbeddingProvider,
  
} from './embedder/index.js';

// Pipeline orchestration
export {
  runIndexPipeline,
  
  
} from './pipeline.js';

// Session for background indexing
;
