/**
 * Search Module
 *
 * Semantic vector search, BM25 keyword search, and hybrid fusion for indexed projects.
 *
 * This module provides the foundation for search functionality:
 * - Dense (vector) search: Semantic similarity using embeddings
 * - Sparse (BM25) search: Exact keyword matching using term frequency
 * - Hybrid (fusion) search: RRF-based combination of dense and sparse
 *
 * @example
 * ```typescript
 * // Semantic search (finds related concepts)
 * import { createSearchService } from './search/index.js';
 *
 * // dimensions is REQUIRED - must match indexed embedding model
 * const search = createSearchService(projectId, provider, config.search, {
 *   dimensions: 1024, // Required - no default
 * });
 * const results = await search.search('authentication middleware');
 *
 * // Keyword search (finds exact terms)
 * import { createBM25SearchService } from './search/index.js';
 *
 * const bm25 = createBM25SearchService(projectId, config.search);
 * const results = await bm25.search('PostgreSQL connection');
 *
 * // Hybrid search (best of both worlds)
 * import { createFusionService } from './search/index.js';
 *
 * // dimensions is REQUIRED in denseOptions
 * const hybrid = createFusionService(projectId, provider, config.search, {
 *   denseOptions: { dimensions: 1024 }, // Required - no default
 * });
 * const results = await hybrid.search('database optimization');
 * ```
 *
 * @packageDocumentation
 */

// Dense (vector) search service
;

// Sparse (BM25) search service
;

// Hybrid (fusion) search service
export {
  FusionService,
  createFusionService,
} from './fusion.js';

// Reranking service
export { RerankerService } from './reranker.js';

// Store management - Vector
export {
  getVectorStoreManager,
  resetVectorStoreManager,
} from './store.js';

// Store management - BM25
export {
  getBM25StoreManager,
  resetBM25StoreManager,
} from './bm25-store.js';

// Store management - Multi-Project Vector
;

// Store management - Multi-Project BM25
;

// Store management - Multi-Project Fusion (combines Vector + BM25)
export { getMultiProjectFusionService } from './multi-project-fusion.js';

// Result formatting
export {
  formatResults,
  formatResultsJSON,
} from './formatter.js';

// Types
export type { SearchResultWithContext } from './types.js';

// Error types
export { EmbeddingMismatchError } from './errors.js';
