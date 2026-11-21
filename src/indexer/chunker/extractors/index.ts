/**
 * Extractors
 *
 * Content extractors for different file types.
 * Each extractor produces ExtractedSegment[] ready for chunking.
 */

export { extractCodeSegments, wholeFile } from './code-extractor.js';

export { prepareLanguage } from './wasm-grammars.js';

export { extractMarkdownSegments } from './markdown-extractor.js';
