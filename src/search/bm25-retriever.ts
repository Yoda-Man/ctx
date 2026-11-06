/**
 * BM25 Search Service
 *
 * High-level BM25 search API over a project's FtsRetriever (SQLite FTS5).
 * Handles result formatting and metadata filtering.
 *
 * Use this for keyword-based search where exact term matching matters:
 * - Finding specific function/class names
 * - Searching for error codes or technical terms
 * - Matching exact phrases in documentation
 */


import { getBM25StoreManager, type FtsRetriever } from './bm25-store.js';
import { formatSearchResult, matchesFilters } from './shared-formatting.js';
import type {
  SearchConfig,
  SearchQueryOptions,
  SearchResultWithContext,
  IndexBuildProgress,
  BM25ServiceOptions,
} from './types.js';

/**
 * BM25 search service for keyword-based search within a project.
 *
 * Provides a simple interface for searching indexed content:
 * 1. Lazily loads chunks from SQLite on first search
 * 2. Builds BM25 index from chunk content
 * 3. Performs keyword matching using BM25 scoring
 * 4. Returns results with full context for display
 *
 * @example
 * ```typescript
 * const service = createBM25SearchService('project-123', {
 *   top_k: 10,
 *   rerank: false,
 * });
 *
 * // Exact keyword search
 * const results = await service.search('PostgreSQL connection pool', {
 *   topK: 5,
 *   fileType: 'code',
 * });
 *
 * for (const result of results) {
 *   console.log(`${result.filePath}:${result.lineRange.start}-${result.lineRange.end}`);
 *   console.log(`Score: ${result.score.toFixed(3)}`);
 * }
 * ```
 */
export class BM25SearchService {
  private retriever: FtsRetriever | null = null;
  private chunkCount: number = 0;
  private readonly projectId: string;
  private readonly config: SearchConfig;

  constructor(config: SearchConfig, options: BM25ServiceOptions) {
    this.config = config;
    this.projectId = options.projectId;
  }

  /**
   * Ensure the retriever is initialized.
   *
   * Lazily loads the BM25 index on first search.
   * Safe to call multiple times - only initializes once.
   */
  async ensureInitialized(
    onProgress?: (progress: IndexBuildProgress) => void
  ): Promise<void> {
    if (this.retriever) return;

    const retriever = await getBM25StoreManager().getRetriever({ projectId: this.projectId }, onProgress);
    this.retriever = retriever;

    // Cache chunk count for later queries
    this.chunkCount = retriever.documentCount;
  }

  /**
   * Perform a keyword search using BM25.
   *
   * @param query - Keyword search query (exact terms matter)
   * @param options - Search options (topK, filters, etc.)
   * @returns Array of results with context, sorted by BM25 score (descending)
   */
  async search(
    query: string,
    options: SearchQueryOptions = {}
  ): Promise<SearchResultWithContext[]> {
    await this.ensureInitialized();

    const topK = options.topK ?? this.config.top_k;

    // Perform BM25 retrieval; file type and language filter before the topK cut
    const filter: Record<string, string> = {};
    if (options.fileType) filter.fileType = options.fileType;
    if (options.language) filter.language = options.language;
    const results = await this.retriever!.retrieve(query, { topK, filter });

    // Convert to our result format and apply filters using shared utilities
    return results
      .map((result) =>
        formatSearchResult(
          result.chunk.id,
          result.score,
          result.chunk.content,
          result.chunk.metadata
        )
      )
      .filter((result) => matchesFilters(result, options));
  }

  /**
   * Get the number of indexed chunks for this project.
   */
  async getChunkCount(): Promise<number> {
    await this.ensureInitialized();
    return this.chunkCount;
  }

  /**
   * Check if the BM25 index is initialized.
   */
  isInitialized(): boolean {
    return this.retriever !== null;
  }

  /**
   * Get the project ID this service is scoped to.
   */
  getProjectId(): string {
    return this.projectId;
  }
}

/**
 * Create a BM25 search service for a project.
 *
 * This is the main entry point for BM25 search functionality.
 *
 * @param projectId - Project to search within
 * @param config - Search configuration from config.toml
 * @param options - Additional options (BM25 tuning parameters)
 * @returns Configured BM25SearchService instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const search = createBM25SearchService(projectId, config);
 * const results = await search.search('authentication middleware');
 * ```
 */
export function createBM25SearchService(projectId: string, config: SearchConfig): BM25SearchService {
  return new BM25SearchService(config, { projectId });
}
